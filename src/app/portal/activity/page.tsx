import { ActivityList } from "@/components/portal/activity-list";

import { getPortalClient } from "../_lib/portal-context";
import { loadWallet } from "../_lib/wallet";

export const metadata = { title: "Activity" };

export default async function PortalActivityPage() {
  const { client } = await getPortalClient();
  const wallet = await loadWallet(client.id, 80);

  return (
    <section className="portal-feed portal-feed-page" aria-labelledby="portal-all-activity">
      <div className="portal-feed-head">
        <h2 id="portal-all-activity">Activity</h2>
        <p>{wallet.activityTotal} transaction{wallet.activityTotal === 1 ? "" : "s"}</p>
      </div>
      <ActivityList items={wallet.activity} />
    </section>
  );
}
