export { ReserveCacheError, ValidationError, isFeatureAvailable as isCacheAvailable, restoreCache, saveCache } from '@actions/cache'
export { resolvePaths } from '@actions/cache/lib/internal/cacheUtils'
export { cacheDir as cacheToolDir, downloadTool, extractTar, extractZip, find as findToolCache } from '@actions/tool-cache'
