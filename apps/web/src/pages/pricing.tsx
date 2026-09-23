import { CheckIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const plans = [
  {
    description: "A place to start your next idea.",
    featured: false,
    features: ["1 project", "Core design tools", "Community support"],
    interval: "Free forever",
    name: "Starter",
    price: "$0",
  },
  {
    description: "More room for your best work.",
    featured: true,
    features: [
      "Unlimited projects",
      "Advanced design tools",
      "Priority support",
    ],
    interval: "per month",
    name: "Pro",
    price: "$19",
  },
  {
    description: "Bring your team and ideas together.",
    featured: false,
    features: ["Everything in Pro", "Shared team workspace", "Team management"],
    interval: "per month",
    name: "Team",
    price: "$49",
  },
] as const;

export const PricingPage = () => (
  <main className="h-full overflow-auto bg-background px-4 py-12 text-foreground sm:px-8 sm:py-20">
    <div className="mx-auto flex max-w-5xl flex-col gap-10">
      <header className="space-y-3 text-center">
        <p className="font-medium text-muted-foreground text-sm">Pricing</p>
        <h1 className="font-semibold text-3xl tracking-tight sm:text-4xl">
          A plan for every idea
        </h1>
        <p className="text-muted-foreground">
          Start small. Make room for more as you grow.
        </p>
      </header>
      <section aria-label="Pricing plans" className="grid gap-5 md:grid-cols-3">
        {plans.map((plan) => (
          <Card
            className={
              plan.featured
                ? "relative ring-2 ring-primary [--card-spacing:--spacing(6)]"
                : "[--card-spacing:--spacing(6)]"
            }
            key={plan.name}
          >
            <CardHeader className="gap-2">
              <div className="flex min-h-6 items-center justify-between gap-2">
                <CardTitle className="text-lg">
                  <h2>{plan.name}</h2>
                </CardTitle>
                {plan.featured ? (
                  <span className="rounded-full bg-primary px-2.5 py-1 font-medium text-primary-foreground text-xs">
                    Most popular
                  </span>
                ) : null}
              </div>
              <CardDescription>{plan.description}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-6">
              <p className="space-y-1">
                <span className="block font-semibold text-4xl tracking-tight">
                  {plan.price}
                </span>
                <span className="block text-muted-foreground">
                  {plan.interval}
                </span>
              </p>
              <ul className="space-y-3 border-t pt-6">
                {plan.features.map((feature) => (
                  <li className="flex items-start gap-2" key={feature}>
                    <CheckIcon
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0"
                    />
                    {feature}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  </main>
);
