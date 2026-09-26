# gear-ai

Workshop desk for service advisors, with a customer chat.

## Where things live

`src/app` holds the routes; each folder's `actions.ts` has its server actions. The logic behind
them lives in `src/lib`, one folder per feature:

| Folder | What it does |
|---|---|
| `lib/db.ts`, `lib/ai.ts`, `lib/format.ts` | Shared basics: the Neon SQL client, the model client (Google Gemini, through its OpenAI-compatible endpoint), formatting helpers |
| `lib/auth/` | `session.ts` signed session cookie (also used by `src/proxy.ts`); `accounts.ts` sign-in and the current advisor or customer |
| `lib/follow-ups/` | The Re-evaluate job and its cron (every 6 hours, then the retention pass): `rules.ts` (next service dates, service intervals), `ai-review.ts` (model reads visit notes), `run.ts` (the passes), `context.ts` (input and saving), `queries.ts` (the `/service-due` list) |
| `lib/chat/` | Customer conversations: `thread.ts` (reading), `messages.ts` (posting, booking and skips from a message), `assistant.ts` (AI replies and problem triage), `constants.ts` (limits) |
| `lib/booking/` | Free slots and the public booking page's data |
| `lib/invoices/` | `pricing.ts` (totals with GST; a static price list for appointments without a job card) and `queries.ts` |
| `lib/mail/` | Gmail `transport.ts`, and one file per email |
| `lib/job-cards/` | `plan.ts`: when a visit is booked, picks the skill, a free mechanic, parts and an estimate, and creates the job card in the booking statement; `queries.ts` |
| `lib/feedback/` | Ratings asked for after each invoice: `save.ts` (the customer's stars and comment), `ai-review.ts` (model reads the comment for sentiment and topics; low ratings become complaints), `queries.ts` (the customer's ratings for the assistant, mechanic scores for job assignment) |
| `lib/retention/` | Customers slipping away, as a pass of the same 6-hourly job: `detect.ts` (missed slots, unanswered booking links, passed service dates, skipped offers), `outreach.ts` (asks "what got in the way?" in the chat and by email, and acts on the answer), `owner.ts` (alerts the workshop owner; the Today page list), `reasons.ts` |
| `lib/home/` | The home page (`/`): `briefing.ts` (today's numbers and what needs a person), `activity.ts` ("GEAR is working", read from what the automations already record) |
| `lib/appointments/`, `lib/vehicles/` | The queries behind those pages |

UI pieces are in `src/components` (`chat/` and `booking/` for those features). Database changes
are in `db/migrations`, numbered in the order to apply them.

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
# ai-axom-assignment
