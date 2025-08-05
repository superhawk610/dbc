use tokio::sync::mpsc::{Sender, channel, error::TrySendError};

pub enum WorkerMessage {
    Subscribe(Sender<String>),
    Broadcast(String),
}

pub fn init() {
    let (tx, mut rx) = channel::<WorkerMessage>(100);

    tokio::spawn(async move {
        let mut txs: Vec<Sender<String>> = Vec::new();

        while let Some(msg) = rx.recv().await {
            match msg {
                WorkerMessage::Subscribe(tx) => txs.push(tx),
                WorkerMessage::Broadcast(text) => {
                    txs.retain(|tx| match tx.try_send(text.clone()) {
                        Err(TrySendError::Closed(_)) => false,
                        Err(TrySendError::Full(_)) => true,
                        Ok(_) => true,
                    });
                }
            }
        }
    });

    tokio::spawn(async move {
        loop {
            let _ = tx.send(WorkerMessage::Broadcast("tick".to_owned())).await;
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
    });
}
