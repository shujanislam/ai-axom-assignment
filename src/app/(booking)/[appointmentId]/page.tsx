import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SparkIcon } from "@/components/icons";
import { getBookingAppointment } from "@/lib/booking/queries";
import { formatSlot, groupSlotsByDay } from "@/lib/booking/slots";
import { getFreeSlots } from "@/lib/job-cards/plan";
import { SlotPicker } from "@/components/booking/slot-picker";
import { bookSlot } from "./actions";

export const metadata: Metadata = { title: "Book your service · gear-ai" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function BookingPage({ params }: PageProps<"/[appointmentId]">) {
  const { appointmentId } = await params;
  if (!UUID.test(appointmentId)) notFound();
  const appointment = await getBookingAppointment(appointmentId);
  if (!appointment) notFound();

  const vehicle = appointment.vehicle_type
    ? `${appointment.vehicle_type} ${appointment.vehicle_number}`
    : appointment.vehicle_number;

  let body;
  if (appointment.status === "DUE") {
    const { job, slots } = await getFreeSlots(appointment.appointment_type);
    const hours = job.labour_hours === 1 ? "about an hour" : `about ${job.labour_hours} hours`;
    body = (
      <>
        <p className="mt-1 text-[13.5px] text-muted">
          Pick a time to bring your {vehicle} in. Times are in India time; the work takes {hours}.
        </p>
        <SlotPicker days={groupSlotsByDay(slots)} book={bookSlot.bind(null, appointment.id)} />
      </>
    );
  } else if (appointment.status === "SCHEDULED" && appointment.scheduled_at) {
    body = (
      <p className="mt-1 text-[14px] text-muted">
        You’re booked for <strong className="font-semibold text-ink">{formatSlot(appointment.scheduled_at)}</strong>.
        Bring your {vehicle} to the workshop at that time. To change it, call the workshop.
      </p>
    );
  } else {
    body = (
      <p className="mt-1 text-[14px] text-muted">
        This booking link is no longer active. Please call the workshop if you’d like to book a visit.
      </p>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-[480px]">
        <div className="flex items-center justify-center gap-2.5">
          <span className="grid size-[34px] place-items-center rounded-[10px] bg-ink text-white">
            <SparkIcon size={17} strokeWidth={1.8} />
          </span>
          <span className="text-[17px] font-semibold italic tracking-[-0.02em]">gear-ai</span>
        </div>

        <section className="mt-8 rounded-[20px] bg-white px-7 pb-7 pt-8">
          <p className="text-[13px] text-muted">Hi {appointment.customer_name},</p>
          <h1 className="mt-1 text-[26px] font-bold italic leading-tight tracking-[-0.03em]">
            {appointment.appointment_type}
          </h1>
          {body}
        </section>
      </div>
    </main>
  );
}
