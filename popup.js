/**
 * @file The popup page for the extension, runs when the extensions toolbar button is clicked on
 * The page shows the status for the idle time, the last idle time, and the running status
 * It also provides a settings link that will open the options.html page
 * @author Ray Engelking
 */

var bgnd=chrome.extension.getBackgroundPage();
var tdStatus,tdIdle,tdUpload,idleTime,idle,lastUpdate,update;

/**
 * Called on the window onload event (when the popup has loaded)
 * The page shows the status for the idle time, the last idle time, and the running status
 * It also provides a settings link that will open the options.html page
 */
function init() {
	tdStatus=document.getElementById("tdStatus");
	tdStatus.innerHTML=(bgnd.running?"Running":"Stopped");

	tdIdle=document.getElementById("tdIdle");
	if(bgnd.idle) {
		idle=parseFloat(bgnd.idle);
		idleTime=(idle<1?Math.floor(idle*60)+" second":idle+" minute")+(idle!=1?"s":"");
	} else {
		idleTime="-NA-"
	}
	tdIdle.innerHTML=idleTime;
	
	tdUpload=document.getElementById("tdUpload");
	
	if(localStorage.lastUpdate) {
		var dt=new Date(+localStorage.lastUpdate);
		var hours=dt.getHours();
		var amPm=(hours>11?"PM":"AM");
		if(hours>12) {
			hours-=12;
		} else if(hours==0) {
			hours=12;
		}
		var minutes="0"+dt.getMinutes();
		minutes=minutes.substring(minutes.length-2);
		update=hours+":"+minutes+" "+amPm;
	} else {
		update="None";
	}
	
	tdUpload.innerHTML=update;
}

window.onload=init;
