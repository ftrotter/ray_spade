/**
 * @file The options page for the extension, runs on first run of the extension, 
 * when called from the settings link in the popup, 
 * and when the options link is clicked on the the chrome://extensions page
 * The page allows for setting and updating the token and the idle time
 * and saves these settings to local storage.
 * @author Ray Engelking
 */

var btnGenerate,txtToken,btnSave,selIdle,option,txt;
var token,idleTimes=[.25,1,3,5,10],idle;
var bgnd=chrome.extension.getBackgroundPage();

/**
 * Called on the DOMContentLoaded event (when the page has loaded)
 * The page allows for setting and updating the token and the idle time
 * and saves these settings to local storage.
 */
function init() {
	
	token=localStorage.token;
	if(!token) token="";
	
	idle=localStorage.idle;
	if(!idle) idle="5";
	
	txtToken=document.getElementById("txtToken");
	txtToken.value=token;
	
	btnGenerate=document.getElementById("btnGenerate");
	btnGenerate.addEventListener("click",function() {
		txtToken.value=s4()+s4()+'-'+s4()+'-'+s4()+'-'+s4()+'-'+s4()+s4()+s4();
	});
	
	selIdle=document.getElementById("selIdle");
	
	//add idle time entries
	for(var i=0;i<idleTimes.length;i++) {
		var idleTime=idleTimes[i];

		option=document.createElement("option");
		option.setAttribute("value",idleTime);

		txt=document.createTextNode((idleTime<1?Math.floor(idleTime*60)+" second":idleTime+" minute")+(idleTime!=1?"s":""));
		option.appendChild(txt);

		option.selected=(idleTime==idle);
		selIdle.appendChild(option);
	}
	
	btnSave=document.getElementById("btnSave");
	btnSave.addEventListener("click",function() {
		var token=txtToken.value.trim();
		var idle=selIdle.options[selIdle.selectedIndex].value;
		if(token.length>0) {
			localStorage.token=token;
			localStorage.idle=idle;
			bgnd.init()
			alert("Settings have been saved!");
			self.close();
		} else {
			alert("Please generate a token first!");
		}
	});

}

function s4() {
	return Math.floor((1+Math.random())*0x10000).toString(16).substring(1);
}

document.addEventListener('DOMContentLoaded',init);

