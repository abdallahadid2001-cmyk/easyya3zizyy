import { createServerFn } from "@tanstack/react-start";

type TableType = "soldiers" | "power" | "consumption";

type OcrInput = { imageBase64: string; mime: string; table: TableType };

const PROMPTS: Record<TableType, string> = {
  soldiers:
    "هذه لقطة شاشة من لعبة. استخرج قائمة الصفوف الظاهرة. كل صف يحتوي على: رقم العدد (count) ثم علامة +/- (sign) ثم زمن مكتوب بصيغة d:h:m:s أو h:m:s. أعد JSON فقط بهذه الصيغة: {\"rows\":[{\"count\":number,\"sign\":\"+\"|\"-\",\"days\":number,\"hours\":number,\"minutes\":number,\"seconds\":number}]} بدون أي شرح.",
  power:
    "هذه لقطة شاشة من لعبة لتدريب دفعة من الجيش بإحصائيات القلعة الكاملة. استخرج رقمين فقط: (1) عدد الجنود (soldiers): الرقم الموجود داخل خانة التحكم بين علامتي + و -، غالباً تحت الموارد/أسفل الفضة والبلور وفوق الوقت. تجاهل تماماً أي رقم تسبقه كلمة لديك أو يمثل العدد المملوك ولا تدخله في soldiers. (2) قيمة زيادة قوة القتال (power): الرقم الذهبي بعد علامة +. حوّل الاختصارات K/M/B إلى أرقام كاملة. أعد JSON فقط: {\"soldiers\":number,\"power\":number} بدون أي شرح.",
  consumption:
    "هذه لقطة شاشة من لعبة لتدريب دفعة جنود. استخرج: (1) عدد جنود الدفعة (batchSoldiers) — رقم يظهر بين علامتي + و - أو داخل خانة إدخال. (2) خمسة أرقام للموارد بالترتيب: قمح (wheat)، خشب (wood)، حديد (iron)، فضة (silver)، بلور (crystal) — تظهر فوق عدد الجنود مع أيقونات الموارد. حوّل الاختصارات: K=ألف، M=مليون، B=مليار. أعد JSON فقط بدون أي شرح: {\"batchSoldiers\":number,\"wheat\":number,\"wood\":number,\"iron\":number,\"silver\":number,\"crystal\":number}",
};

export const ocrExtract = createServerFn({ method: "POST" })
  .inputValidator((d: OcrInput) => d)
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY not configured");

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPTS[data.table] },
              {
                type: "image_url",
                image_url: { url: `data:${data.mime};base64,${data.imageBase64}` },
              },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`AI gateway error ${resp.status}: ${text.slice(0, 200)}`);
    }
    const j = await resp.json();
    const content: string = j?.choices?.[0]?.message?.content ?? "{}";
    try {
      return JSON.parse(content);
    } catch {
      // Try to find a JSON block
      const m = content.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      throw new Error("Invalid AI response");
    }
  });
