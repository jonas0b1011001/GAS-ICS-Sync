<a href="https://drive.google.com/open?id=1vHwCz1dGsBzapoxPjxkhMRzDI71q-eeFZdr6dw0vnl13IlVxVLQepJS_">Script Download</a>

This script is a rework of <a href="https://github.com/derekantrican/GAS-ICS-Sync">derekantrican/GAS-ICS-Sync</a> modified to use the Google Calendar API v3.


<ul>Additional features:
  <li><ul>Multicalendar support, merge multiple ical calendars to various google calendars
    <li>Option to add sourcecalendar name to event title (if available)</li>
    </ul></li>
  <li>Support of VTODO-Elements</li>
  <li><ul>Full Recurrence support
    <li>RRULE, EXRULE, RDATE, EXDATE, RECURRENCE-ID</li></ul></li>
  <li><ul>Full mapping of ICAL properties to Google Calendar Event Properties
    <li>Attendees (Name, Mail, Response), Status, Sequence, Class, Transp, URL</li>
    </ul></li>
  <li>EMail notification when an event is updated by the script</li>
  <li>Exponential Backoff to handle API-throttling</li>
  <li>Support any Interval as trigger</li>
</ul>
