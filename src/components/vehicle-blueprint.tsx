"use client";

import { useState } from "react";

type Hit = { cx: number; cy: number; r: number; leader: string; y: number; label: string; note: string };

type BodyType = {
  key: string;
  label: string;
  stamp: string;
  wheelbase: string;
  /** Wheel centres, radius and the body-line height. */
  wheels: [number, number];
  wheelY: number;
  wheelR: number;
  bodyStartX: number;
  bodyEndX: number;
  body: string;
  details: string[];
  brake: Omit<Hit, "label" | "note" | "y">;
  ac: Omit<Hit, "label" | "note" | "y">;
  acLabelY: number;
};

const bodyTypes: BodyType[] = [
  {
    key: "sedan",
    label: "Sedan",
    stamp: "SEDAN · 4 DOOR",
    wheelbase: "WHEELBASE 2,600 mm",
    wheels: [258, 530],
    wheelY: 160,
    wheelR: 30,
    bodyStartX: 150,
    bodyEndX: 660,
    body: "M150 160 L150 140 C150 128 157 120 168 117 L278 100 L316 66 C322 59 331 55 341 55 L448 55 C460 55 470 59 477 66 L514 98 L602 104 C618 106 628 115 629 128 L630 152 C630 157 627 160 622 160 L560 160 A30 30 0 0 0 500 160 L288 160 A30 30 0 0 0 228 160 L150 160 Z",
    details: [
      "M322 70 C326 65 332 62 340 62 L444 62 C452 62 458 65 462 70 L490 96 L300 96 Z",
      "M382 62 L382 96",
      "M422 62 L422 96",
      "M326 96 L327 150 M410 96 L411 152 M482 96 L483 150",
      "M172 150 L610 150",
      "M156 122 L184 118 L186 129 L158 132 Z",
      "M606 112 L626 116 L626 129 L606 127 Z",
      "M318 98 L305 95 L302 102 L315 105 Z",
      "M358 108 h18 M438 108 h18",
    ],
    brake: { cx: 258, cy: 160, r: 35, leader: "M252 170 L214 194 L132 194" },
    ac: { cx: 390, cy: 80, r: 13, leader: "M382 72 L340 42 L132 42" },
    acLabelY: 39,
  },
  {
    key: "suv",
    label: "SUV",
    stamp: "SUV · 5 DOOR",
    wheelbase: "WHEELBASE 2,740 mm",
    wheels: [262, 520],
    wheelY: 152,
    wheelR: 38,
    bodyStartX: 144,
    bodyEndX: 620,
    body: "M144 152 L144 128 C144 116 151 108 163 105 L262 96 L300 58 C306 49 316 44 328 44 L536 44 C548 44 557 49 562 58 L584 100 C590 112 594 122 594 132 L594 146 C594 150 592 152 588 152 L558 152 A38 38 0 0 0 482 152 L300 152 A38 38 0 0 0 224 152 L144 152 Z",
    details: [
      "M336 42 L528 42",
      "M308 60 C312 54 320 50 328 50 L530 50 C538 50 545 54 549 61 L566 96 L290 96 Z",
      "M374 50 L374 96",
      "M442 50 L442 96",
      "M502 50 L502 96",
      "M312 96 L313 142 M408 96 L409 144 M490 96 L491 142",
      "M166 136 L570 136",
      "M150 110 L180 106 L182 118 L152 121 Z",
      "M572 106 L588 112 L588 128 L572 124 Z",
      "M304 98 L291 95 L288 102 L301 105 Z",
      "M350 106 h18 M430 106 h18",
    ],
    brake: { cx: 262, cy: 152, r: 43, leader: "M254 164 L216 194 L132 194" },
    ac: { cx: 392, cy: 70, r: 13, leader: "M384 62 L340 32 L132 32" },
    acLabelY: 29,
  },
  {
    key: "hatch",
    label: "Hatchback",
    stamp: "HATCHBACK · 5 DOOR",
    wheelbase: "WHEELBASE 2,450 mm",
    wheels: [270, 502],
    wheelY: 160,
    wheelR: 29,
    bodyStartX: 184,
    bodyEndX: 620,
    body: "M184 160 L184 140 C184 129 190 121 202 118 L294 104 L332 66 C338 59 347 55 357 55 L474 55 C486 55 496 60 502 69 L544 124 C550 133 553 141 553 149 L553 155 C553 158 551 160 547 160 L532 160 A29 29 0 0 0 473 160 L299 160 A29 29 0 0 0 240 160 L184 160 Z",
    details: [
      "M338 71 C342 65 349 62 357 62 L470 62 C478 62 485 66 489 73 L516 98 L316 98 Z",
      "M396 62 L396 98",
      "M452 62 L452 98",
      "M342 98 L343 150 M420 98 L421 152 M494 98 L512 142",
      "M206 150 L536 150",
      "M190 122 L216 118 L218 129 L192 132 Z",
      "M524 108 L544 122 L538 131 L518 119 Z",
      "M334 100 L321 97 L318 104 L331 107 Z",
      "M372 110 h18 M446 110 h18",
    ],
    brake: { cx: 270, cy: 160, r: 34, leader: "M263 170 L222 194 L132 194" },
    ac: { cx: 404, cy: 82, r: 13, leader: "M396 74 L352 42 L132 42" },
    acLabelY: 39,
  },
];

// Hatching under the ground line, shared by every body type.
const groundHatch = Array.from({ length: 23 }, (_, i) => `M${148 + i * 24} 190 L${140 + i * 24} 198`).join(" ");

const stroke = {
  body: { fill: "none", stroke: "var(--bp-line)", strokeWidth: 1.5, strokeLinejoin: "round", strokeLinecap: "round" },
  detail: { fill: "none", stroke: "var(--bp-line-2)", strokeWidth: 1, strokeLinejoin: "round", strokeLinecap: "round" },
  guide: { fill: "none", stroke: "var(--bp-guide)", strokeWidth: 0.8, strokeDasharray: "5 4" },
  dim: { fill: "none", stroke: "var(--bp-guide)", strokeWidth: 0.8 },
  ground: { fill: "none", stroke: "var(--bp-line-2)", strokeWidth: 1 },
} as const;

const text = { fontSize: 8.5, fill: "var(--bp-muted)" } as const;
const flagText = { ...text, fill: "var(--bp-accent)", fontWeight: 600, letterSpacing: "0.05em" } as const;
const stampText = { ...text, fill: "#aeaea6", letterSpacing: "0.1em" } as const;

function Flag({ cx, cy, r, leader, labelY, label, note }: BodyType["brake"] & { labelY: number; label: string; note: string }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--bp-accent)" strokeWidth={0.9} opacity={0.5} />
      <circle cx={cx} cy={cy} r={3} fill="var(--bp-accent)" />
      <path d={leader} fill="none" stroke="var(--bp-accent)" strokeWidth={0.8} strokeDasharray="3 3" />
      <text x={124} y={labelY} textAnchor="end" style={flagText}>
        {label}
      </text>
      <text x={124} y={labelY + 12} textAnchor="end" style={text}>
        {note}
      </text>
    </g>
  );
}

export type BlueprintFlags = { brake: boolean; ac: boolean };

function Drawing({ type, flags }: { type: BodyType; flags: BlueprintFlags }) {
  const [front, rear] = type.wheels;
  const { wheelY: y, wheelR: r } = type;

  return (
    <svg viewBox="0 0 700 250" className="block h-auto w-full" role="img" aria-labelledby={`bp-${type.key}-t`}>
      <title id={`bp-${type.key}-t`}>
        {`Side schematic of a ${type.label.toLowerCase()}, with the front brake and cabin air-conditioning areas marked`}
      </title>

      <line x1={front} y1={48} x2={front} y2={206} style={stroke.guide} />
      <line x1={rear} y1={48} x2={rear} y2={206} style={stroke.guide} />
      <line x1={type.bodyStartX} y1={y} x2={type.bodyEndX} y2={y} style={stroke.guide} />

      <line x1={140} y1={190} x2={680} y2={190} style={stroke.ground} />
      <path d={groundHatch} style={stroke.dim} opacity={0.6} />

      <path d={type.body} style={stroke.body} />
      {type.details.map((d) => (
        <path key={d} d={d} style={stroke.detail} />
      ))}

      {type.wheels.map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy={y} r={r} style={stroke.body} />
          <circle cx={cx} cy={y} r={r * 0.83} style={stroke.guide} />
          <circle cx={cx} cy={y} r={r * 0.63} style={stroke.detail} />
          <circle cx={cx} cy={y} r={r > 35 ? 5 : 4} style={stroke.detail} />
        </g>
      ))}

      {flags.brake && <Flag {...type.brake} labelY={191} label="BRAKE · FRONT AXLE" note="Pads, discs, calipers" />}
      {flags.ac && <Flag {...type.ac} labelY={type.acLabelY} label="AC · CABIN CIRCUIT" note="Leak trace, pressures" />}

      <g style={stroke.dim}>
        <line x1={front} y1={214} x2={rear} y2={214} />
        <path
          d={`M${front} 209 L${front} 219 M${rear} 209 L${rear} 219 M${front + 5} 211 L${front} 214 L${front + 5} 217 M${rear - 5} 211 L${rear} 214 L${rear - 5} 217`}
        />
      </g>
      <text x={(front + rear) / 2} y={230} textAnchor="middle" style={text}>
        {type.wheelbase}
      </text>
      <text x={46} y={238} style={stampText}>
        SIDE ELEVATION · NOT TO SCALE
      </text>
      <text x={654} y={238} textAnchor="end" style={stampText}>
        {type.stamp}
      </text>
    </svg>
  );
}

const cornerMarks = [
  "left-[11px] top-[11px] border-l border-t",
  "right-[11px] top-[11px] border-r border-t",
  "bottom-[11px] left-[11px] border-b border-l",
  "bottom-[11px] right-[11px] border-b border-r",
];

export function VehicleBlueprint({
  plate,
  bodyType = "sedan",
  flags,
}: {
  plate: string;
  bodyType?: "sedan" | "suv" | "hatch";
  flags: BlueprintFlags;
}) {
  const [active, setActive] = useState<string>(bodyType);

  return (
    <section aria-label="Vehicle blueprint" className="rounded-[20px] bg-white px-6 pb-5 pt-[22px]">
      <div className="flex flex-col items-start justify-between gap-x-5 gap-y-3 sm:flex-row">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">{plate} — body layout</h2>
          <p className="mt-[3px] text-[12px] text-muted">
            {flags.brake || flags.ac
              ? "Schematic only. Marked areas carry an open recommendation for this vehicle."
              : "Schematic only. No brake or AC recommendations are open."}
          </p>
        </div>
        <div role="tablist" aria-label="Body type" className="flex shrink-0 gap-1 rounded-xl bg-canvas p-[3px]">
          {bodyTypes.map((t) => (
            <button
              key={t.key}
              role="tab"
              id={`tab-${t.key}`}
              aria-selected={active === t.key}
              aria-controls={`bp-${t.key}`}
              onClick={() => setActive(t.key)}
              className={`rounded-[10px] px-3.5 py-[7px] text-[12.5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
                active === t.key ? "bg-white font-medium text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="blueprint-paper relative mt-4 overflow-hidden rounded-2xl">
        {cornerMarks.map((pos) => (
          <span key={pos} className={`absolute size-[11px] border-(--bp-guide) ${pos}`} />
        ))}
        {bodyTypes.map((t) => (
          <div key={t.key} id={`bp-${t.key}`} role="tabpanel" aria-labelledby={`tab-${t.key}`} hidden={active !== t.key}>
            <Drawing type={t} flags={flags} />
          </div>
        ))}
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-x-[18px] gap-y-2 text-[11.5px] text-muted">
        <span className="flex items-center gap-[7px]">
          <span className="size-[6px] rounded-full bg-amber" />
          Open recommendation
        </span>
        <span className="grow" />
        <span>Drawing is indicative, not the vehicle&apos;s actual dimensions.</span>
      </div>
    </section>
  );
}
