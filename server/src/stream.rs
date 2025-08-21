use std::sync::OnceLock;

use tokio::sync::mpsc::{Sender, channel, error::TrySendError};

pub struct StreamWorker {
    tx: Sender<WorkerMessage>,
}

pub enum WorkerMessage {
    Subscribe(Sender<String>),
    Broadcast(String),
}

impl WorkerMessage {
    pub fn into_message(self) -> String {
        match self {
            WorkerMessage::Broadcast(msg) => msg,
            WorkerMessage::Subscribe(_) => panic!("subscribe has no message"),
        }
    }
}

static GLOBAL: OnceLock<StreamWorker> = OnceLock::new();

pub fn init() {
    GLOBAL.get_or_init(|| StreamWorker::new());
}

pub fn global() -> &'static StreamWorker {
    GLOBAL.get().expect("stream::init() must be called first")
}

pub async fn subscribe(tx: Sender<String>) -> Result<(), ()> {
    global().subscribe(tx).await
}

pub async fn broadcast<S: Into<String>>(msg: S) {
    if let Err(msg) = global().broadcast(msg.into()).await {
        tracing::error!("Failed to broadcast message: {msg}");
    }
}

impl StreamWorker {
    pub fn new() -> Self {
        let (tx, mut rx) = channel::<WorkerMessage>(100);

        tokio::spawn(async move {
            let mut cache: Vec<String> = Vec::new();
            let mut txs: Vec<Sender<String>> = Vec::new();

            'outer: while let Some(msg) = rx.recv().await {
                match msg {
                    WorkerMessage::Subscribe(tx) => {
                        // replay all previous messages
                        for msg in cache.iter() {
                            match tx.try_send(msg.clone()) {
                                // if the channel closes, no need to store it
                                Err(TrySendError::Closed(_)) => continue 'outer,
                                _ => {}
                            };
                        }

                        // subscribe to future messages
                        txs.push(tx);
                    }
                    WorkerMessage::Broadcast(text) => {
                        // send the message to all current subscribers
                        txs.retain(|tx| match tx.try_send(text.clone()) {
                            Err(TrySendError::Closed(_)) => false,
                            Err(TrySendError::Full(_)) => true,
                            Ok(_) => true,
                        });

                        // store the message for future replays
                        cache.push(text);
                    }
                }
            }
        });

        // send some sample messages to prove everything's working
        // {
        //     let tx = tx.clone();
        //     tokio::spawn(async move {
        //         for _ in 1..20 {
        //             let _ = tx.send(WorkerMessage::Broadcast("tick".to_owned())).await;
        //             tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        //         }
        //     });
        // }

        Self { tx }
    }

    /// Subscribe to messages from the stream.
    pub async fn subscribe(&self, tx: Sender<String>) -> Result<(), ()> {
        self.tx
            .send(WorkerMessage::Subscribe(tx))
            .await
            .map_err(|_| ())
    }

    /// Broadcast a message to all subscribers. On failure, returns the message that failed to send.
    pub async fn broadcast(&self, msg: String) -> Result<(), String> {
        self.tx
            .send(WorkerMessage::Broadcast(msg))
            .await
            .map_err(|err| err.0.into_message())
    }
}
