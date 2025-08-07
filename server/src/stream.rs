use tokio::sync::mpsc::{Sender, channel, error::TrySendError};

pub struct StreamWorker {
    tx: Sender<WorkerMessage>,
}

pub enum WorkerMessage {
    Subscribe(Sender<String>),
    Broadcast(String),
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

        // FIXME: remove ticks
        {
            let tx = tx.clone();
            tokio::spawn(async move {
                for _ in 1..20 {
                    let _ = tx.send(WorkerMessage::Broadcast("tick".to_owned())).await;
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                }
            });
        }

        Self { tx }
    }

    pub async fn subscribe(&mut self, tx: Sender<String>) -> Result<(), ()> {
        self.tx
            .send(WorkerMessage::Subscribe(tx))
            .await
            .map_err(|_| ())
    }

    pub async fn broadcast(&mut self, msg: String) -> Result<(), ()> {
        self.tx
            .send(WorkerMessage::Broadcast(msg))
            .await
            .map_err(|_| ())
    }
}
