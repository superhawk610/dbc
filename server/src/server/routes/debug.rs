use poem::web::Data;
use std::sync::Arc;

#[poem::handler]
pub async fn get_state(Data(state): Data<&Arc<crate::State>>) -> eyre::Result<String> {
    Ok(state.debug().await)
}
