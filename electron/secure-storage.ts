export function secureStorageCapability(platform = process.platform) {
  return platform === 'darwin' || platform === 'win32'
}
