import { Upcoming } from "@/components/Upcoming";

export default function Invoices() {
  return (
    <Upcoming
      title="Invoices are on their way"
      items={["What's awaiting payment, and what's past due", "Mark an invoice as paid", "Share its PDF"]}
      when="Arrives in phase 4. Until then, invoices are on the web."
    />
  );
}
