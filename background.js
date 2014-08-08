/**
 * @file The background page for the extension, runs hidden all the time.
 * Handles checking for the idle time and checking and sending urls to the save_tree.php page
 * @author Ray Engelking
 */

var idle,token,running=false
var uploadItems,allHistoryItems,allHistoryItemsTemp,allVisitItems,allVisitItems,verifiedItems,lastUpdate,thisUpdate,processing=false;
var url_tree,chrome_urls,chrome_visits,db;

//localStorage.removeItem("lastUpdate");  //for testing only
//localStorage.removeItem("token");  //for testing only
//localStorage.removeItem("idle");  //for testing only
/**
 * Initializes the background page when it loads.
 * - checks for the token and idle, and if not present then loads the options page
 * - the options page will call init() again upon saving settings
 * - sets up the idle listener
 * - when idle, it starts processing all the links that came before the idle and after the last processing time
 * - gets a list of allHistoryItems
 * - gets a sublist of uploadItems
 * - filters the uploadItems to a list of verifiedItems (nih.gov or wikipedia with matching keywords)
 * - gets a list of allVisitItems for each entry in allHistoryItems
 * - at this point allHistoryItems, allVisitItems, and verifiedItems are filled
 * - so just need to extract the trees, by calling traverseAndPost
 * - sets the time of this update in local storage
 */
function init() {
	token=localStorage.token; 
	idle=localStorage.idle;  //idle upload interval in minutes (float)

	//if no token yet, then show the option page, and quit the init for now
	//as the options page will call the init when ready
	if(!token) {
		chrome.tabs.create({"url": "options.html"});
		return;
	}

	//at this point, idle and token are set
	console.log("token:"+token);
	console.log("idle:"+idle);

	var idleSecs=Math.floor(parseFloat(idle)*60);
	console.log("idleSecs:"+idleSecs);
	//update the idle detection interval
	chrome.idle.setDetectionInterval(idleSecs); 

	//check if running already, don't add the listener twice
	console.log("running:"+running);
	if(!running) {
		running=true;


		//create and/or open database
		db=window.openDatabase("history","1.0","Supplemental Chrome History Database",1073741824);  //max size 1GB
		//create the urls table if it doesn't exist yet
		db.transaction(function(tx) {
			tx.executeSql("CREATE TABLE urls (id INTEGER PRIMARY KEY,url LONGVARCHAR,title LONGVARCHAR,visit_count INTEGER DEFAULT 0 NOT NULL,typed_count INTEGER DEFAULT 0 NOT NULL,last_visit_time INTEGER NOT NULL,hidden INTEGER DEFAULT 0 NOT NULL,favicon_id INTEGER DEFAULT 0 NOT NULL)");
			tx.executeSql("CREATE INDEX IF NOT EXISTS last_visit_time_idx ON urls (last_visit_time)");
		});

		//add listener to listen for history items
		chrome.history.onVisited.addListener(function(historyItem) {
			console.log("NEW HISTORY_ITEM:"+JSON.stringify(historyItem));
			//upsert the history item to the current database
			db.transaction(function(tx) {
				tx.executeSql("INSERT OR REPLACE INTO urls (id,url,title,visit_count,typed_count,last_visit_time) VALUES(?,?,?,?,?,?)",[historyItem.id,historyItem.url,historyItem.title,historyItem.visitCount,historyItem.typedCount,historyItem.lastVisitTime]);
			});
		});

		//add listener to check for idle
		chrome.idle.onStateChanged.addListener(function(newState) {
			console.log("newState:"+newState);

			//check if chrome has been idle and it is not currently processing from a previous idle
			if(newState=="idle" && !processing) {
				processing=true;

				lastUpdate=parseFloat(localStorage.lastUpdate) || 0.0;
				thisUpdate=(new Date).getTime();	

				//clear the upload list
				uploadItems=[];

				//search all the recent history items
				db.transaction(function (tx) {
					tx.executeSql("SELECT * FROM urls WHERE last_visit_time>=?",[lastUpdate],function(tx,results) {
						var historyItems=[];
						var len=results.rows.length,i;
						for(i=0;i<len;i++){
							r=results.rows.item(i);
							historyItems.push({"id":r.id,"url":r.url,"title":r.title,"visitCount":r.visit_count,"typedCount":r.typed_count,"lastVisitTime":r.last_visit_time});
						}
						
						//OPTIONAL: empty the supplemental history table, after every use
						//tx.executeSql("DELETE FROM urls");

						for(var n=0;n<historyItems.length;n++) {
							console.log("HISTORY id:"+historyItems[n].id+"  url:"+historyItems[n].url);
						}
						//save all the history items because we need these urls to get all the visits
						allHistoryItemsTemp=historyItems;

						//get all history items with matching url
						for(var i=0;i<historyItems.length;i++) {
							var historyItem=historyItems[i];

							//is nih.gov or wikipedia.org
							if(/^https?:\/\/(.+\.)?(wikipedia\.org|nih\.gov)\//.test(historyItem.url)) {
								uploadItems.push(historyItem);
							}
						}

						//get the history items (look up wikipedia links and verify they are medical
						verifiedItems=[];
						verifyUploadItems(function(success) {
							if(success && verifiedItems.length>0) {
								allVisitItems=[];
								allHistoryItems=[];

								getAllVisits(function(success) {
									if(success) {
										//at this point allHistoryItems, allVisitItems, and verifiedItems are filled
										//so just need to extract the trees
										traverseAndPost(function(success) {
											//all verifiedItems have been posted at this point
											localStorage["lastUpdate"]=thisUpdate;  //comment out for testing of all links
											processing=false;
										});
									} else {
										processing=false;
									}
								});
							} else {
								processing=false;
							}
						});
					},null);
				});
			}
		});
	}
}

/**
 * Finds a specific VisitItem from the list of allVisitItems for this HistoryItem, matching on historyItem.id and historyItem.lastVisitTime
 * @param {HistoryItem} historyItem - the historyItem to search for
 */
function findVisitItemByHistoryItem(historyItem) {
	for(var i=0;i<allVisitItems.length;i++) {
		var visitItem=allVisitItems[i];
		if(visitItem.id==historyItem.id && visitItem.visitTime==historyItem.lastVisitTime) return visitItem;
	}
	return null;
}

/**
 * Finds a specific VisitItem from the list of allVisitItems for this visitId
 * @param {integer} visitId - the visitId to search for
 */
function findVisitItemByVisitId(visitId) {
	for(var i=0;i<allVisitItems.length;i++) {
		var visitItem=allVisitItems[i];
		if(visitItem.visitId==visitId) return visitItem;
	}
	return null;
}

/**
 * Finds a specific HistoryItem from the list of allHistoryItems for this id
 * @param {integer} id - the id to search for
 */
function findHistoryItemById(id) {
	for(var i=0;i<allHistoryItems.length;i++) {
		var historyItem=allHistoryItems[i];
		if(historyItem.id==id) return historyItem;
	}
	return null;
}

/**
 * Gets all visits with referringVisitId equal to this visitId (the children)
 * for each child visit add the visit to the chrome_visits array
 * for each chil visit add the url historyItem for the visit to the chrome_urls array
 * for each chil visit call addChildren to get the children of this child, recursively
 * @param {integer} visitId -  the visitId to search for
 */
function addChildren(visitId,level) {
	if(!level) {
		level="----"; 
	} else {
		level+="----";
	}
	//get all visits with referringVisitId equal to this visitId
	for(var i=0;i<allVisitItems.length;i++) {
		var visitItem=allVisitItems[i];
		if(visitItem.referringVisitId==visitId) {
			//for each one add url, and add visit to chrome_urls and chrome_visits
			//add the visit
			chrome_visits.push({
				visit_id: visitItem.visitId,
				url_id: visitItem.id,
				visit_time: visitItem.visitTime,
				from_visit: visitItem.referringVisitId,
				transition: visitItem.transition,
				segment_id: 0,
				is_indexed: 0,
				visit_duration: 0
			});
			
			//add the parent url
			historyItem=findHistoryItemById(visitItem.id);
			if(historyItem) {
				console.log(level+"CHILD:"+historyItem.url+"  visitItem.visitId:"+visitItem.visitId);
				//don't add it, if already in the chrome_urls
				if(chrome_urls.map(function(e) { return e.url_id; }).indexOf(historyItem.id)==-1) {
					chrome_urls.push({
						url_id: historyItem.id,
						url: historyItem.url,
						title: historyItem.title,
						visit_count: historyItem.visitCount,
						typed_count: historyItem.typedCount,
						last_visit_time: historyItem.lastVisitTime,
						hidden: 0,
						favicon_id: 0
					});
				}
			}			

			//for each one call addChildren(visitId), to get any children of this child
			addChildren(visitItem.visitId,level);
		}
	}
}

/**
 * Traverses and posts each item in the verifiedItems array, starting with the first one
 * fills in the chrome_urls and chrome_visits arrays
 * adds the url and visit for this verified item
 * traversing down the visits table, to last leaf in tree from url by calling addChildren for this verified item
 * then traverses up the visits table to the first typed domain, and add associated urls and visits
 * then saves the tree to the save_tree.php along with the token
 * calls itself with the next verifiedItem, unless there are none left, then it calls the callback function
 * @param {function} callback -  the function to call when this routine completes
 */
function traverseAndPost(callback) {
	if(verifiedItems.length==0) {
		//no verifiedItems so return success
		if(callback) callback(true);
		return;
	}
	//look up each verifiedItem
	var historyItem=verifiedItems.pop();

	console.log("historyItem:"+JSON.stringify(historyItem));

	//upload verified items
	chrome_urls=[];
	chrome_visits=[];
	
	//get the visitItem of this history item
	var visitItem=findVisitItemByHistoryItem(historyItem);
    var startURL=historyItem.url;
	//traverse up the visits table to the first typed domain, and add associated urls and visits
	while(true) {
		var referringVisitId=visitItem.referringVisitId;
		//break if no parent (have reached the ultimate parent)
		if(referringVisitId=="0") break;
		
		//get parent visitItem
		var tempVisitItem=findVisitItemByVisitId(visitItem.referringVisitId);
		//break if parent not in list 
		if(!tempVisitItem) break;
		
		//this is the next parent upward in the tree
		visitItem=tempVisitItem;
	}
	

	//add the ultimate parent visit
	chrome_visits.push({
		visit_id: visitItem.visitId,
		url_id: visitItem.id,
		visit_time: visitItem.visitTime,
		from_visit: visitItem.referringVisitId,
		transition: visitItem.transition,
		segment_id: 0,
		is_indexed: 0,
		visit_duration: 0
	});
	
	//add the parent url
	historyItem=findHistoryItemById(visitItem.id);
	if(historyItem) {
		console.log("START URL:"+startURL);
		console.log("ULTIMATE PARENT URL:"+historyItem.url);
		//don't add it, if already in the chrome_urls
		if(chrome_urls.map(function(e) { return e.url_id; }).indexOf(historyItem.id)==-1) {
			chrome_urls.push({
				url_id: historyItem.id,
				url: historyItem.url,
				title: historyItem.title,
				visit_count: historyItem.visitCount,
				typed_count: historyItem.typedCount,
				last_visit_time: historyItem.lastVisitTime,
				hidden: 0,
				favicon_id: 0
			});
		}
	}

	//traverse down the visits table, to last leaf in tree from url
	//recurse branches
	addChildren(visitItem.visitId);	
	
	//sort the urls and visits
	chrome_urls.sort(function(a,b) {
		if(a.url_id>b.url_id) return 1;
		if(a.url_id<b.url_id) return -1;
		return 0;
	});	
	
	chrome_visits.sort(function(a,b) {
		if(a.visit_id>b.visit_id) return 1;
		if(a.visit_id<b.visit_id) return -1;
		return 0;
	});	

	url_tree={chrome_urls:chrome_urls,chrome_visits:chrome_visits};
	
	saveTree(function(success) {
		if(success) {
			//check to see if any more verifiedItems to process
			if(verifiedItems.length>0) {
				//more verifiedItems to get so get them
				traverseAndPost(callback);
			} else {
				//none left so call the callback
				if(callback) callback(true);
			}
		} else {
			//error saving the url_tree
			if(callback) callback(false);
		}
	});
}

/**
 * Gets all the visits associated with the list of HistoryItems in allHistoryItemsTemp
 * fills in the allHistoryItems array with all the history items (as they are processed)
 * fills in the allVisitItems array with all the visit items associated with each history item (as they are processed)
 * calls itself, unless there are no allHistoryItemsTemp left, then it calls the callback function
 * @param {function} callback -  the function to call when this routine completes
 */
function getAllVisits(callback) {
	if(allHistoryItemsTemp.length==0) {
		//no allHistoryItemsTemp so return success
		if(callback) callback(true);
		return;
	}
	//have all the urls, now get the visits, one at a time
	var historyItem=allHistoryItemsTemp.pop();
	//save this history item in the main list
	allHistoryItems.push(historyItem);
	console.log("historyItem:"+JSON.stringify(historyItem));
	chrome.history.getVisits({"url":historyItem.url},function(visitItems) {
		for(var i=0;i<visitItems.length;i++) {
			var visitItem=visitItems[i];
			console.log("  --  visitItem:"+JSON.stringify(visitItem));
			allVisitItems.push(visitItem);
		}
		//check to see if any more allHistoryItemsTemp to process
		if(allHistoryItemsTemp.length>0) {
			//more allHistoryItemsTemp to get so get them
			getAllVisits(callback);
		} else {
			//none left so call the callback
			if(callback) callback(true);
		}
	});
}

/**
 * Saves the tree in the url_tree variable (put there from traverseAndPost)
 * then it calls the callback function
 * @param {function} callback -  the function to call when this routine completes
 */
function saveTree(callback) {
	var url="http://spade.ft1.us/save_tree.php";
	var url_tree_string=JSON.stringify(url_tree);
	console.log("saveTree():"+url_tree_string);
	
//	if(callback) callback(true); //for testing only
//	return; //for testing only
	
	var query="url_tree="+encodeURIComponent(url_tree_string)+"&user_token="+encodeURIComponent(token);
	var req=new XMLHttpRequest();

	req.onreadystatechange=function(e) {
		if(req.readyState==4) {
			if(req.status==200) {
				try {
					var json=JSON.parse(req.responseText);
					console.log("saveTree() result:"+json.result);
					if(callback) callback(json.result=="saved");
				} catch(error) {
					console.log("saveTree() error:"+req.responseText);
					if(callback) callback(false);
				}
			} else {
				console.log("saveTree() error:"+req.responseText);
				if(callback) callback(false);
			}
			
		}
	}

	req.open("POST",url,true);
	req.setRequestHeader("Content-Type","application/x-www-form-urlencoded");
	req.send(query);
}

/**
 * Verifies all the urls in the uploadItems array and puts them in the verifiedItems array
 * for nih.gov, they are add to the list immediately
 * for wikipedia links, the page is loaded from wikipedia and uses the clinical_detect routine (in javascript) to verify the page
 * calls itself, unless there are no uploadItems left, then it calls the callback function
 * @param {function} callback -  the function to call when this routine completes
 */
function verifyUploadItems(callback) {
	if(uploadItems.length==0) {
		//no uploadItems so return success
		if(callback) callback(true);
		return;
	}
	
	//get next uploadItem to query for
	var uploadItem=uploadItems.pop();
	var url=uploadItem.url;

	//if nih.gov then verify immediately
	if(/^https?:\/\/(.+\.)?nih\.gov\//.test(url)) {
		console.log("adding nih url:"+url);
		verifiedItems.push(uploadItem);
		
		//check to see if any more uploadItems to process
		if(uploadItems.length>0) {
			//more uploadItems to get so get them
			verifyUploadItems(callback);
		} else {
			//none left so call the callback
			if(callback) callback(true);
		}
	} else {
		var query="http://spade.ft1.us/is_title_clinical.php?wiki_url="+encodeURIComponent(url);

		console.log("verifying url:"+url);
		//item is wikipedia so look up the page and verify
		var req=new XMLHttpRequest();

		req.onreadystatechange=function(e) {
			if(req.readyState==4) {
				if(req.status==200) {
					try {
						var json=JSON.parse(req.responseText);
						console.log("is_title_clinical() result:"+json.is_clinical);
						
						//check the wiki text for key terms
						if(json.is_clinical) {
							console.log("adding wiki url:"+url);
							verifiedItems.push(uploadItem);
						}

					} catch(e) {
						console.log("parse error:"+e.message);
					}

					//check to see if any more uploadItems to process
					if(uploadItems.length>0) {
						//more uploadItems to get so get them
						verifyUploadItems(callback);
					} else {
						//none left so call the callback
						if(callback) callback(true);
					}
				} else {
					console.log("Error verifyUploadItems()");
					console.log(req.responseText);
					if(callback) callback(false);
				}
			}
		}

		req.open("GET",query,true);
		req.send(null);
	}
}

init();