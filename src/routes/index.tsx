import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Calculator } from "@/components/Calculator";
import type { Lang } from "@/lib/i18n";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "حاسبة الساعات والتدريب | Hours & Training Calculator" },
      {
        name: "description",
        content:
          "حاسبة سريعة لتحويل الوحدات إلى ساعات وحساب أعداد الجنود وقوة القتال، مع دعم العربية والإنجليزية وحفظ تلقائي.",
      },
      { property: "og:title", content: "حاسبة الساعات والتدريب" },
      { property: "og:description", content: "أداة موبايل لحساب الساعات والتدريب وقوة القتال." },
    ],
  }),
  component: Index,
});

function Index() {
  const [lang, setLang] = useState<Lang>("ar");
  return <Calculator lang={lang} setLang={setLang} />;
}
