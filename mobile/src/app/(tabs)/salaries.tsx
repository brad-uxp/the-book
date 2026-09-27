import { Upcoming } from "@/components/Upcoming";

export default function Salaries() {
  return (
    <Upcoming
      title="Salaries are on their way"
      items={["Who hasn't been paid this month", "Register a payment, or pay everyone at once", "Paid this month, with dates"]}
      when="Arrives in phase 4. Until then, salaries are on the web."
    />
  );
}
