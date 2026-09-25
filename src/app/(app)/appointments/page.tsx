import type { Metadata } from "next";
import Link from "next/link";
import { Card, Dot, PageHeader } from "@/components/ui";
import { completableStatuses, formatDateTime, statusMeta } from "@/lib/format";
import { getAppointments } from "@/lib/server/queries";
import { CompleteButton } from "./complete-button";

export const metadata: Metadata = { title: "Appointments · Servicedesk" };

export default async function AppointmentsPage() {
  const appointments = await getAppointments();

  return (
    <>
      <PageHeader title="Appointments" subtitle={`${appointments.length} on record, newest first`} />

      <Card className="mt-6 overflow-x-auto px-6 pb-4 pt-4">
        <table className="w-full min-w-[720px] text-left text-[14px]">
          <thead>
            <tr className="border-b border-line text-[12.5px] text-muted">
              <th className="px-1 py-4 font-normal">Vehicle</th>
              <th className="px-1 py-4 font-normal">Customer</th>
              <th className="px-1 py-4 font-normal">Type</th>
              <th className="px-1 py-4 font-normal">Assigned to</th>
              <th className="px-1 py-4 font-normal">Booked</th>
              <th className="px-1 py-4 font-normal">Status</th>
              <th className="w-[190px] px-1 py-4" />
            </tr>
          </thead>
          <tbody>
            {appointments.map((a) => {
              const status = statusMeta(a.status);
              return (
                <tr key={a.id} className="border-b border-line last:border-0">
                  <td className="px-1 py-[17px]">
                    <Link href={`/vehicles/${a.vehicle_number}`} className="font-semibold hover:underline">
                      {a.vehicle_number}
                    </Link>
                  </td>
                  <td className="px-1 py-[17px] text-muted">{a.customer_name}</td>
                  <td className="px-1 py-[17px]">{a.appointment_type}</td>
                  <td className="px-1 py-[17px] text-muted">{a.advisor_name ?? "Unassigned"}</td>
                  <td className="px-1 py-[17px] text-muted tabular">{formatDateTime(a.created_at)}</td>
                  <td className="px-1 py-[17px]">
                    <span className="flex items-center gap-2 text-muted">
                      <Dot tone={status.tone} />
                      {status.label}
                    </span>
                  </td>
                  <td className="px-1 py-[12px] text-right">
                    {completableStatuses.includes(a.status) && <CompleteButton appointmentId={a.id} />}
                  </td>
                </tr>
              );
            })}
            {appointments.length === 0 && (
              <tr>
                <td colSpan={7} className="py-12 text-center text-muted">
                  No appointments yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}
