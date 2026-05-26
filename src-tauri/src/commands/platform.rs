use crate::error::AppError;
use crate::plugins::platform;
use crate::types::PlatformCapabilities;

#[tauri::command]
pub fn get_platform_capabilities(platform_id: String) -> Result<PlatformCapabilities, AppError> {
    let plugin = platform::create_platform_plugin(&platform_id)?;
    Ok(plugin.capabilities())
}
