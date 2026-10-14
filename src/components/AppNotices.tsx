// The one place the desktop app's notices appear (src/lib/notices.ts): at the
// bottom left, one at a time. Never over setup, a dialog, busy work or an
// update, and only in the desktop app: a browser, another server's page,
// companion mode and a dev build have none. Not on a branded build either.
import { useState } from "react";
import { Star } from "lucide-react";
import { api, useStore } from "@/state/store";
import { APP_REPOSITORY } from "@/lib/app-links";
import { brandStatus } from "@/lib/brand";
import { cornerPopupWaits } from "@/lib/corner-popup";
import { dismissNotice, noticeSeen, STAR_NOTICE, usedBefore } from "@/lib/notices";
import type { WelcomeViewer } from "@/lib/onboarding";
import { useUpdaterState } from "@/lib/updater";
import { t } from "@/lib/i18n";
import { LinkButton, NoticeCard, NotNowButton } from "./NoticeCard";
import { localDesktopPage } from "./onboarding/WelcomeGate";

function StarCard({ onDismiss }: { onDismiss: () => void }) {
  return <NoticeCard titleId="github-star-title" notice="github-star" icon={Star} title={t("star.title")} onDismiss={onDismiss}>
    <p className="mb-3 mt-1 text-[12.5px] text-ink-secondary">{t("star.body")}</p>
    <div className="flex flex-wrap items-center gap-3">
      <LinkButton url={APP_REPOSITORY} label={t("star.button")} onOpened={onDismiss} />
      <NotNowButton onClick={onDismiss} />
    </div>
  </NoticeCard>;
}

export function AppNotices({ quiet = false, viewer = null }: { quiet?: boolean; viewer?: WelcomeViewer | null }) {
  const { state, dispatch } = useStore();
  const remote = window.ogb?.remoteClient?.active === true;
  // One notice closed here leaves the rest for another launch.
  const [closed, setClosed] = useState(false);
  const updater = useUpdaterState();
  const record = state.config?.onboarding;
  const waits = cornerPopupWaits(state, updater, { quiet, idle: true, viewer });
  const due = !closed && !waits && !remote && localDesktopPage()
    && brandStatus().source !== "file" && usedBefore(state.bots)
    && !noticeSeen(record, STAR_NOTICE);
  if (!due) return null;

  const dismiss = () => {
    setClosed(true);
    const patch = dismissNotice(record, STAR_NOTICE);
    if (patch) void api("/api/config", { method: "PUT", body: JSON.stringify(patch) })
      .then(config => dispatch({ type: "configStatus", config })).catch(() => {});
  };
  return <StarCard onDismiss={dismiss} />;
}
