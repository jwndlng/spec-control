// The update banner (openspec/specs/update-notice): a thin line above everything when the server learned of a newer
// release. Hook-free, like the Environment panel: the app shell owns the status and the dismissal, so this renders one.
// Nothing here makes a request; the links are ones the user follows, and the macOS app opens them in the browser.
import type { UpdateStatus } from "../shared/types.ts";
import { isReleaseVersion } from "../shared/versions.ts";
import { storageKey } from "./storage.ts";
import { RELEASES_URL } from "./whatsNew.tsx";

export const UPDATE_DISMISSED_KEY = storageKey("updateDismissed");
/** The README's update instructions. */
export const HOW_TO_UPDATE_URL = "https://github.com/jwndlng/spec-control#updating";
/** How often an open page asks the server again; the server itself checks at most once a day. */
export const UPDATE_REREAD_MS = 60 * 60 * 1000;

export const releaseUrl = (tag: string): string => `${RELEASES_URL}/tag/${encodeURIComponent(tag)}`;

/** The version the banner announces, or undefined when there is nothing to announce or the user dismissed that one. */
export function bannerVersion(status: UpdateStatus | undefined, dismissed: string | undefined): string | undefined {
  if (!status?.enabled || !status.available || status.latest === undefined) return undefined;
  return status.latest === dismissed ? undefined : status.latest;
}

/**
 * The version the header shows (openspec/specs/update-notice, "A release build shows its version in the header"): the
 * running version when it is a release tag, whether or not checks are on; nothing for `dev`, the demo or before the
 * status is known.
 */
export function headerVersion(status: UpdateStatus | undefined): string | undefined {
  return status && isReleaseVersion(status.current) ? status.current : undefined;
}

/** The running release beside the product name, linked to its release page; renders nothing for any other build. */
export function VersionLabel({ status }: { status: UpdateStatus | undefined }) {
  const version = headerVersion(status);
  if (version === undefined) return null;
  return (
    <a class="hero-version" href={releaseUrl(version)} target="_blank" rel="noopener noreferrer" aria-label={`Spec Control ${version} release notes`}>
      {version}
    </a>
  );
}

/** The version dismissed in this browser; unset when storage is unavailable, which shows the banner again. */
export function loadDismissed(storage?: Storage): string | undefined {
  try {
    return (storage ?? localStorage).getItem(UPDATE_DISMISSED_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveDismissed(version: string, storage?: Storage): void {
  try {
    (storage ?? localStorage).setItem(UPDATE_DISMISSED_KEY, version);
  } catch {
    // No storage: the banner is hidden for this page load only.
  }
}

export function UpdateBanner({ status, dismissed, onDismiss }: { status: UpdateStatus | undefined; dismissed: string | undefined; onDismiss: (version: string) => void }) {
  const version = bannerVersion(status, dismissed);
  return (
    // Always present, so the polite live region exists before its content arrives and the arrival is announced.
    <div class="update-banner-region" role="status" aria-live="polite">
      {version !== undefined && status && (
        <div class="update-banner">
          <span class="update-banner-text">
            Spec Control <strong>{version}</strong> is available — you have {status.current}.
          </span>
          <a href={releaseUrl(version)} target="_blank" rel="noopener noreferrer">
            Release notes
          </a>
          <a href={HOW_TO_UPDATE_URL} target="_blank" rel="noopener noreferrer">
            How to update
          </a>
          <button type="button" class="btn sm ghost update-banner-dismiss" onClick={() => onDismiss(version)} aria-label={`Dismiss the notice about ${version}`}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
