import { Upcoming } from "@/components/Upcoming";

export default function Metrics() {
  return (
    <Upcoming
      title="Metrics are on their way"
      items={[
        "Invoices awaiting payment",
        "Net income and corporate profitability, without the excluded clients",
        "Partner A / Partner B split",
        "Payments and invoices due in the next 5 days",
      ]}
      when="Arrives in phase 4. Until then, the dashboard is on the web."
    />
  );
}
