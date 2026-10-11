import { SITE_DESCRIPTION } from "../site.ts";

export function ConverterIntro() {
  return <p className="converter-intro">{SITE_DESCRIPTION}</p>;
}

export function ConverterGuide() {
  return (
    <section
      className="converter-guide"
      aria-labelledby="converter-guide-title"
    >
      <h2 id="converter-guide-title">How to convert dates and times</h2>
      <p>
        Paste a message with a date, time and timezone, then choose a city or
        timezone under Convert to. Results update as you type. Copy a converted
        time to use it in your reply.
      </p>
      <p>
        Try “April 9, 2026 3pm in Tokyo” and convert to UTC to get 6:00 am on
        April 9. You can also convert time ranges and Unix timestamps.
      </p>
      <p>
        If the message has no timezone, open Message interpretation and set
        Source timezone. Regional timezones account for daylight saving time;
        fixed UTC offsets stay fixed. Choose an interpretation for ambiguous
        abbreviations, and check the displayed date order for numeric dates.
        Copy range includes both endpoints of an unambiguous interval. Display
        preferences controls the clock format without changing what the message
        means.
      </p>
      <p>
        Conversions run on your device and your message is not sent to a server.
        Once offline readiness is confirmed, you can reopen the app and convert
        new messages without an internet connection.
      </p>
    </section>
  );
}
