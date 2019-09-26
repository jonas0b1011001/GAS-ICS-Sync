/*
*=========================================
*       INSTALLATION INSTRUCTIONS
*=========================================
*
* 1) Click in the menu "File" > "Make a copy..." and make a copy to your Google Drive
* 2) Changes lines 19-32 to be the settings that you want to use
* 3) Enable "Calendar API v3" at "Resources" > "Advanced Google Services" > "Calendar API v3" 
* 4) Click in the menu "Run" > "Run function" > "Install" and authorize the program
*    (For steps to follow in authorization, see this video: https://youtu.be/_5k10maGtek?t=1m22s )
*/
//=====================================================================================================
//!!!!!!!!!!!!!!!! DO NOT EDIT BELOW HERE UNLESS YOU REALLY KNOW WHAT YOU'RE DOING !!!!!!!!!!!!!!!!!!!!
//=====================================================================================================

function Install(){
  //Delete any already existing triggers so we don't create excessive triggers
  DeleteAllTriggers();
  
  //Custom error for restriction here: https://developers.google.com/apps-script/reference/script/clock-trigger-builder#everyMinutes(Integer)
  var validFrequencies = [1, 5, 10, 15, 30];
  if(validFrequencies.indexOf(howFrequent) == -1)
    throw "[ERROR] Invalid value for \"howFrequent\". Must be either 1, 5, 10, 15, or 30";

  ScriptApp.newTrigger("main").timeBased().everyMinutes(howFrequent).create();
}

function Uninstall(){
  DeleteAllTriggers();
}

function DeleteAllTriggers(){
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++){
    if (triggers[i].getHandlerFunction() == "main"){
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

function main(){
  var log = "Log Output:<br>";
  var userProperties = PropertiesService.getUserProperties();
  var tgtCalName = userProperties.getProperty('tgtCalName');
  var targetCalendar;
  var sourceCalendarURLs = [userProperties.getProperty('url')];            // The ics/ical urls that you want to get events from ["url","url","url"]
  var addEventsToCalendar = true;        // If you turn this to "false", you can check the log (View > Logs) to make sure your events are being read correctly before turning this on
  var modifyExistingEvents = true;       // If you turn this to "false", any event in the feed that was modified after being added to the calendar will not update
  var removeEventsFromCalendar = true;   // If you turn this to "true", any event in the calendar not found in the feed will be removed.
  var addAlerts = true;                  // Whether to add the ics/ical alerts as notifications on the Google Calendar events, this will override the standard reminders specified by the target calendar.
  var addOrganizerToTitle = false;       // Whether to prefix the event name with the event organiser for further clarity 
  var addCalToTitle = false;             // Whether to add the source calendar to title
  var addTasks = false;
  
  var emailWhenAdded = false;            // Will email you when an event is added to your calendar
  var emailWhenModified = false;         // Will email you when an existing event is updated in your calendar
  var email = "";  
  var targetCalendarId;
  var response = [];
  
  //Get URL items
  for each (var url in sourceCalendarURLs){
    try{
      var urlResponse = UrlFetchApp.fetch(url).getContentText();
      //------------------------ Error checking ------------------------
      if(!urlResponse.includes("BEGIN:VCALENDAR")){
        log += "<br>" + ("[ERROR] Incorrect ics/ical URL: " + url);
      }
      else{
        response.push(urlResponse);
      }
    }
    catch (e){
      log += "<br>" + (e);
    }
  }
  log += "<br>" + ("Syncing " + response.length + " Calendars.");

  //Get target calendar information
  targetCalendar = Calendar.CalendarList.list({minAccessRole: "writer"}).items.filter(function(cal){return (cal.summary == tgtCalName);});
  targetCalendar = targetCalendar[0];
  
  if(targetCalendar == null){
    var targetCalendar = Calendar.newCalendar();
    targetCalendar.summary = tgtCalName;
    targetCalendar.description = "Created by GAS.";
    targetCalendar.timeZone = Calendar.Settings.get("timezone").value;
    targetCalendar = Calendar.Calendars.insert(targetCalendar);
  }
  targetCalendarId = targetCalendar.id;
  
  log += "<br>" + ("Working on calendar: " + targetCalendar.summary + ", ID: " + targetCalendarId)
  
  if (emailWhenAdded && email == "")
    throw "[ERROR] \"emailWhenAdded\" is set to true, but no email is defined";
  //----------------------------------------------------------------
  
  //------------------------ Parse existing events --------------------------
  if(addEventsToCalendar || removeEventsFromCalendar){ 
    var calendarEvents = Calendar.Events.list(targetCalendarId, {showDeleted: true}).items;
    var calendarEventsIds = [];
    log += "<br>" +  ("Grabbed " + calendarEvents.length + " existing Events from " + tgtCalName); 
    for (var i = 0; i < calendarEvents.length; i++){ 
      calendarEventsIds[i] = calendarEvents[i].iCalUID;
    } 
    log += "<br>" +  ("Saved " + calendarEventsIds.length + " existing Event IDs"); 
  } 
    //------------------------ Parse ics events --------------------------
  var icsEventIds=[];
  var vevents = [];
  var recurringEvents = [];
  
  //Use ICAL.js to parse the data
  for each (var resp in response){
    var jcalData = ICAL.parse(resp);
    var component = new ICAL.Component(jcalData);
    ICAL.helpers.updateTimezones(component);
    var vtimezones = component.getAllSubcomponents("vtimezone");
    for each (var tz in vtimezones){
      ICAL.TimezoneService.register(tz);
    }
    
    var allevents = component.getAllSubcomponents("vevent");
    var calName = component.getFirstPropertyValue("name");
    if (calName != null)
      allevents.forEach(function(event){event.addPropertyWithValue("parentCal", calName); });
    vevents = [].concat(allevents, vevents);
  }
  vevents.forEach(function(event){ icsEventIds.push(event.getFirstPropertyValue('uid').toString()); });  
  
  if (addEventsToCalendar || modifyExistingEvents){
    log += "<br>" +  ("---Processing " + vevents.length + " Events.");
    var calendarTz = Calendar.Settings.get("timezone").value;
    
    for each (var event in vevents){
      vevent = new ICAL.Event(event);
      var requiredAction = "skip";
      var index = calendarEventsIds.indexOf(vevent.uid);
      if (index >= 0){
        //check update
        icsModDate = event.getFirstPropertyValue('last-modified') || event.getFirstPropertyValue('created');
        calModDate = new Date(calendarEvents[index].updated);
        if (calendarEvents[index].status == "cancelled"){
          requiredAction = "update";
        }
        else if (event.hasProperty('recurrence-id')){
          requiredAction = 'update';
        }
        else if (icsModDate === null){
          //manually check if event changed
          if (eventChanged(event, vevent, calendarEvents[index])){
            requiredAction = "update";
          }
        }
        else if (new Date(icsModDate) > calModDate){
          requiredAction = "update";
        }
        else{
          //skip
        }
      }
      else{
        requiredAction = "insert";
      }
      
      if (requiredAction != "skip"){
        var newEvent = Calendar.newEvent();
        if(vevent.startDate.isDate){
          //All Day Event
          newEvent = {
            start: {
              date: vevent.startDate.toString()
            },
            end: {
              date: vevent.endDate.toString()
            }
          };
        }
        else{
          //normal Event
          var tzid = vevent.startDate.timezone;
          if (tzids.indexOf(tzid) == -1){
            log += "<br>" + ("Timezone " + tzid + " unsupported!");
            if (tzid in tzidreplace){
              tzid = tzidreplace[tzid];
            }
            else{
              tzid = calendarTz; 
            }
            log += "<br>" + ("Using Timezone " + tzid + "!");
          };
          newEvent = {
            start: {
              dateTime: vevent.startDate.toString(),
              timeZone: tzid
            },
            end: {
              dateTime: vevent.endDate.toString(),
              timeZone: tzid
            },
          };
        }
        
        newEvent.attendees = [];
        for each (var att in vevent.attendees){
          var name = ParseAttendeeName(att.toICALString());
          var mail = ParseAttendeeMail(att.toICALString());
          var resp = ParseAttendeeResp(att.toICALString());
          newEvent.attendees.push({'displayName': name, 'email': mail, 'responseStatus': resp.toLowerCase()});
        }
        if (event.hasProperty('status')){
          newEvent.status = event.getFirstPropertyValue('status').toString().toLowerCase();
        }
        newEvent.sequence = vevent.sequence;
        newEvent.summary = vevent.summary;
        if (addOrganizerToTitle){
          var organizer = ParseOrganizerName(event.toString());
          
          if (organizer != null)
            newEvent.summary = organizer + ": " + vevent.summary;
        }
        
        if (addCalToTitle && event.hasProperty('parentCal')){
          var calName = event.getFirstPropertyValue('parentCal');
          newEvent.summary = calName + ": " + vevent.summary;
        }
        
        newEvent.iCalUID = vevent.uid;
        newEvent.description = vevent.description;
        newEvent.location = vevent.location;
        if (event.hasProperty('class')){
          newEvent.visibility = event.getFirstPropertyValue('class').toString().toLowerCase();
        }
        if (event.hasProperty('transp')){
          newEvent.transparency = event.getFirstPropertyValue('transp').toString().toLowerCase();
        }
        newEvent.reminders = {
          'useDefault': true
        };
        if (addAlerts){
          var valarms = event.getAllSubcomponents('valarm');
          var overrides = [];
          for each (var valarm in valarms){
            var trigger = valarm.getFirstPropertyValue('trigger').toString();
            if (overrides.length < 5){ //Google supports max 5 reminder-overrides
              overrides.push({'method': 'popup', 'minutes': ParseNotificationTime(trigger)/60});
            }
          }
          if (overrides.length > 0){
            newEvent.reminders = {
              'useDefault': false,
              'overrides': overrides
            };
          }
        }
        
        if (event.hasProperty('rrule') || event.hasProperty('rdate')){
          // Calculate targetTZ's UTC-Offset
          var jsTime = new Date();
          var utcTime = new Date(Utilities.formatDate(jsTime, "Etc/GMT", "HH:mm:ss MM/dd/yyyy"));
          var tgtTime = new Date(Utilities.formatDate(jsTime, calendarTz, "HH:mm:ss MM/dd/yyyy"));
          calendarUTCOffset = tgtTime - utcTime;
          newEvent.recurrence = ParseRecurrenceRule(event, calendarUTCOffset);
        }
        
        if (event.hasProperty('recurrence-id')){
          
          newEvent.recurringEventId = event.getFirstPropertyValue('recurrence-id').toString();
          log += "<br>" + ("--Saving Eventinstance for later");
          recurringEvents.push(newEvent);
          
        }
        else{
          
          var retries = 0;
          do{
            Utilities.sleep(retries * 100);
            switch (requiredAction){
              case "insert":
                if (addEventsToCalendar){
                  log += "<br>" + ("Adding new Event " + newEvent.iCalUID);
                  try{
                    newEvent = Calendar.Events.insert(newEvent, targetCalendarId);
                    if (emailWhenAdded){
                      GmailApp.sendEmail(email, "New Event \"" + newEvent.summary + "\" added", "New event added to calendar \"" + targetCalendarName + "\" at " + vevent.start.toString());
                    }
                  }catch(error){
                    log += "<br>" + ("Error, Retrying..." + error );
                  }
                }
                break;
              case "update":
                if (modifyExistingEvents){
                  log += "<br>" + ("Updating existing Event!");
                  try{
                    newEvent = Calendar.Events.update(newEvent, targetCalendarId, calendarEvents[index].id);
                    if (emailWhenModified){
                      GmailApp.sendEmail(email, "Event \"" + newEvent.summary + "\" modified", "Event was modified in calendar \"" + targetCalendarName + "\" at " + vevent.start.toString());
                    }
                  }catch(error){
                    log += "<br>" + ("Error, Retrying..." + error);
                  }
                }
                break;
            }
            retries++;
          }while(retries < 5 && (typeof newEvent.etag === "undefined"))
          
        }
      }
      else{
        //Skipping
        log += "<br>" + ("Event unchanged. No action required.")
      }
    }
    log += "<br>" + ("---done!");
  }
  
  //-------------- Remove old events from calendar -----------
  if(removeEventsFromCalendar){
    log += "<br>" + ("Checking " + calendarEvents.length + " events for removal");
    for (var i = 0; i < calendarEvents.length; i++){
      var currentID = calendarEventsIds[i];
      var feedIndex = icsEventIds.indexOf(currentID);
      
      if(feedIndex  == -1 && calendarEvents[i].status != "cancelled"){
        log += "<br>" + ("Deleting old Event " + currentID);
        try{
          Calendar.Events.remove(targetCalendarId, calendarEvents[i].id);
        }catch (err){
          log += "<br>" + (err);
        }
      }
    }
    log += "<br>" + ("---done!");
  }
  //----------------------------------------------------------------
  if (addTasks)
    parseTasks();
  //------Add Recurring Event Instances-----------
  log += "<br>" + ("---Processing " + recurringEvents.length + " Recurrence Instances!");
  for each (var recEvent in recurringEvents){
    log += "<br>" + ("-----" + recEvent.recurringEventId.substring(0,10));
    var addedEvents = Calendar.Events.list(targetCalendarId, {iCalUID: recEvent.iCalUID}).items;
    if (addedEvents.length == 0){ //Initial Event has Recurrence-id
      try{
        Calendar.Events.insert(recEvent, targetCalendarId);
      }catch(error){
      }
    }else{ //Find the instance we need to update
      var instances = Calendar.Events.instances(targetCalendarId, addedEvents[0].id).items;
      addedEvents = instances.filter(function(event){
        var start = event.start.date || event.start.dateTime;
        return start.includes(recEvent.recurringEventId.substring(0,10))
      });
      if (addedEvents.length > 0){
        try{
          Calendar.Events.patch(recEvent, targetCalendarId, addedEvents[0].id);
        }catch(error){
          log += "<br>" + (error); 
        }
      }
    }
  }
  return log;
}

function ParseRecurrenceRule(vevent, utcOffset){
  var recurrenceRules = vevent.getAllProperties('rrule');
  var exDates = vevent.getAllProperties('exdate');
  var rDates = vevent.getAllProperties('rdate');
  var recurrence = [];
  for each (var recRule in recurrenceRules){
    var recIcal = recRule.toICALString();
    var adjustedTime;
    var untilMatch = RegExp("(.*)(UNTIL=)(\\d\\d\\d\\d)(\\d\\d)(\\d\\d)T(\\d\\d)(\\d\\d)(\\d\\d)(;.*|\\b)", "g").exec(recIcal);
    if (untilMatch != null) {
      adjustedTime = new Date(Date.UTC(parseInt(untilMatch[3],10),parseInt(untilMatch[4], 10)-1,parseInt(untilMatch[5],10), parseInt(untilMatch[6],10), parseInt(untilMatch[7],10), parseInt(untilMatch[8],10)));
      adjustedTime = (Utilities.formatDate(new Date(adjustedTime - utcOffset), "etc/GMT", "YYYYMMdd'T'HHmmss'Z'"));
      recIcal = untilMatch[1] + untilMatch[2] + adjustedTime + untilMatch[9];
    }
    recurrence.push(recIcal);
  }
  for each (var exDate in exDates){
    recurrence = recurrence.concat(exDate.toICALString());
  }
  for each (var rDate in rDates){
    recurrence = recurrence.concat(rDate.toICALString());
  }
  return recurrence;
}

function ParseAttendeeName(veventString){
  var nameMatch = RegExp("(CN=)([^;$]*)(:MAILTO:)([^;$]*)", "g").exec(veventString);
  if (nameMatch != null && nameMatch.length > 1)
    return nameMatch[2];
  else
    return null;
}

function ParseAttendeeMail(veventString){
  var mailMatch = RegExp("(CN=)([^;$]*)(:MAILTO:)([^;$]*)", "g").exec(veventString);
  if (mailMatch != null && mailMatch.length > 1)
    return mailMatch[4];
  else
    return null;
}

function ParseAttendeeResp(veventString){
  var respMatch = RegExp("(PARTSTAT=)([^;$]*)", "g").exec(veventString);
  if (respMatch != null && respMatch.length > 1)
    return respMatch[2];
  else
    return null;
}

function ParseOrganizerName(veventString){
  /*A regex match is necessary here because ICAL.js doesn't let us directly
  * get the "CN" part of an ORGANIZER property. With something like
  * ORGANIZER;CN="Sally Example":mailto:sally@example.com
  * VEVENT.getFirstPropertyValue('organizer') returns "mailto:sally@example.com".
  * Therefore we have to use a regex match on the VEVENT string instead
  */

  var nameMatch = RegExp("ORGANIZER(?:;|:)CN=(.*?):", "g").exec(veventString);
  if (nameMatch != null && nameMatch.length > 1)
    return nameMatch[1];
  else
    return null;
}

function ParseNotificationTime(notificationString){
  //https://www.kanzaki.com/docs/ical/duration-t.html
  var reminderTime = 0;

  //We will assume all notifications are BEFORE the event
  if (notificationString[0] == "+" || notificationString[0] == "-")
    notificationString = notificationString.substr(1);

  notificationString = notificationString.substr(1); //Remove "P" character

  var secondMatch = RegExp("\\d+S", "g").exec(notificationString);
  var minuteMatch = RegExp("\\d+M", "g").exec(notificationString);
  var hourMatch = RegExp("\\d+H", "g").exec(notificationString);
  var dayMatch = RegExp("\\d+D", "g").exec(notificationString);
  var weekMatch = RegExp("\\d+W", "g").exec(notificationString);

  if (weekMatch != null){
    reminderTime += parseInt(weekMatch[0].slice(0, -1)) & 7 * 24 * 60 * 60; //Remove the "W" off the end

    return reminderTime; //Return the notification time in seconds
  }
  else{
    if (secondMatch != null)
      reminderTime += parseInt(secondMatch[0].slice(0, -1)); //Remove the "S" off the end

    if (minuteMatch != null)
      reminderTime += parseInt(minuteMatch[0].slice(0, -1)) * 60; //Remove the "M" off the end

    if (hourMatch != null)
      reminderTime += parseInt(hourMatch[0].slice(0, -1)) * 60 * 60; //Remove the "H" off the end

    if (dayMatch != null)
      reminderTime += parseInt(dayMatch[0].slice(0, -1)) * 24 * 60 * 60; //Remove the "D" off the end

    return reminderTime; //Return the notification time in seconds
  }
}

function parseTasks(){
  var taskLists = Tasks.Tasklists.list().items;
  var taskList = taskLists[0];
  
  var existingTasks = Tasks.Tasks.list(taskList.id).items || [];
  var existingTasksIds = []
  log += "<br>" + ("Grabbed " + existingTasks.length + " existing Tasks from " + taskList.title);
  for (var i = 0; i < existingTasks.length; i++){
    existingTasksIds[i] = existingTasks[i].id;
  }
  log += "<br>" + ("Saved " + existingTasksIds.length + " existing Task IDs");
  
  var icsTasksIds = [];
  var vtasks = [];
  
  for each (var resp in response){
    var jcalData = ICAL.parse(resp);
    var component = new ICAL.Component(jcalData);
    
    vtasks = [].concat(component.getAllSubcomponents("vtodo"), vtasks);
  }
  vtasks.forEach(function(task){ icsTasksIds.push(task.getFirstPropertyValue('uid').toString()); });
  log += "<br>" + ("---Processing " + vtasks.length + " Tasks.");
  
  for each (var task in vtasks){
    var newtask = Tasks.newTask();
    newtask.id = task.getFirstPropertyValue("uid").toString();
    newtask.title = task.getFirstPropertyValue("summary").toString();
    var d = task.getFirstPropertyValue("due").toJSDate();
    newtask.due = (d.getFullYear()) + "-" + ("0"+(d.getMonth()+1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2) + "T" + ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2) + ":" + ("0" + d.getSeconds()).slice(-2)+"Z";
    Tasks.Tasks.insert(newtask, taskList.id);
  };
  log += "<br>" + ("---Done!");
  
  //-------------- Remove old Tasks -----------
  // ID can't be used as identifier as the API reassignes a random id at task creation
  if(removeEventsFromCalendar){
    log += "<br>" + ("Checking " + existingTasksIds.length + " tasks for removal");
    for (var i = 0; i < existingTasksIds.length; i++){
      var currentID = existingTasks[i].id;
      var feedIndex = icsTasksIds.indexOf(currentID);
      
      if(feedIndex  == -1){
        log += "<br>" + ("Deleting old Task " + currentID);
        Tasks.Tasks.remove(taskList.id, currentID);
      }
    }
    log += "<br>" + ("---Done!");
  }
  //----------------------------------------------------------------
}

function eventChanged(event, icsEvent, calEvent){
  if (icsEvent.description != calEvent.description)
    return true;
  if (icsEvent.summary != calEvent.summary)
    return true;
  if (icsEvent.location != calEvent.location)
    return true;
  var startDate = calEvent.start.date || calEvent.start.dateTime;
  startDate = new ICAL.Time().fromJSDate(new Date(startDate), true);
  if (startDate.compare(icsEvent.startDate) != 0)
    return true;
  var endDate = calEvent.end.date || calEvent.end.dateTime;
  endDate = new ICAL.Time().fromJSDate(new Date(endDate), true);
  if (endDate.compare(icsEvent.endDate) != 0)
    return true;
//  Need to manually build the recurrence-array
//  var recurrenceRules = event.getAllProperties('rrule');
//  var recurrence = [];
//  if (recurrenceRules != null)
//    for each (var recRule in recurrenceRules){
//      recurrence.push("RRULE:" + recRule.getFirstValue().toString());
//    }
//  var exDatesRegex = RegExp("EXDATE(.*)", "g");
//  var exdates = event.toString().match(exDatesRegex);
//  if (exdates != null){
//    recurrence = recurrence.concat(exdates);
//  }
//  var rDatesRegex = RegExp("RDATE(.*)", "g");
//  var rdates = event.toString().match(rDatesRegex);
//  if (rdates != null){
//    recurrence = recurrence.concat(rdates);
//  }
//  Logger.log("Comparing recurrence: " + recurrence + " - " + calEvent.recurrence);
//  if (icsEvent.recurrence != calEvent.recurrence)
//    return true;
  
  return false;
}

function doGet() {
  var html = HtmlService.createTemplateFromFile("script").evaluate();
  html.setTitle("ICAL to Google Calendar");
  return html;
}

function getSettings(){
  var userProperties = PropertiesService.getUserProperties();
  var calendars = Calendar.CalendarList.list({minAccessRole: "writer"}).items.map(function(cal){return cal.summary;});
  var tgtCalName = userProperties.getProperty('tgtCalName');
  var url = userProperties.getProperty('url');
  return [calendars, tgtCalName, url];
}

function setSettings(tgtCalName, url){
  var userProperties = PropertiesService.getUserProperties();
  userProperties.setProperty('tgtCalName', tgtCalName);
  userProperties.setProperty('url', url);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename)
      .setSandboxMode(HtmlService.SandboxMode.IFRAME)
      .getContent();
}