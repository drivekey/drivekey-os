// Evidence identifies an unfunded candidate, not a release authorization.
export const offlineReleaseStatus = {
  fundingReady: false,
  productionReady: false,
  candidateId: 'candidate-20261012-r1791992121830',
  imageId: 'image-20261012-r1791992121830',
  filename: 'image-20261012-r1791992121830-unfunded.iso',
  sha256: 'bfa25263aa76449a8d60c2ed2e020d33ece4cb6d86a1011a1712f52946be8fa3',
  evidenceDirectory: 'outputs/image-repeatability/2026-10-14T15-35-21.830Z-c0c67010',
  message: 'Offline release pending security verification. Do not fund a wallet created with these research builds.',
} as const;

// This permits inspection of legacy artifacts only. It never authorizes a
// release, accepts a request parameter, or permits production/hosted serving.
export function legacyResearchDownloadsEnabled(): boolean {
  return process.env.DRIVEKEY_ENABLE_LEGACY_RESEARCH_DOWNLOADS === '1'
    && (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test')
    && !process.env.VERCEL;
}

export function blockedOfflineReleaseResponse(): Response {
  return Response.json({
    error: offlineReleaseStatus.message,
    code: 'OFFLINE_RELEASE_NOT_APPROVED',
    fundingReady: false,
    productionReady: false,
  }, {status: 503, headers: {'Cache-Control': 'no-store'}});
}
