var idle,token,running=false,uploadItems,allHistoryItems,allHistoryItemsTemp,allVisitItems,allVisitItems,verifiedItems,lastUpdate,thisUpdate,processing=false;
var url_tree,chrome_urls,chrome_visits;

//localStorage.removeItem("lastUpdate");  //for testing only
//localStorage.removeItem("token");  //for testing only
//localStorage.removeItem("idle");  //for testing only

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
		
		//add listener to check for idle
		chrome.idle.onStateChanged.addListener(function(newState) {
			console.log("newState:"+newState);
			
			//check if chrome has been idle and it is not currently processing from a previous idle
			if(newState=="idle" && !processing) {
				processing=true;
				
				lastUpdate=parseFloat(localStorage.lastUpdate) || 0.0;
				thisUpdate=(new Date).getTime();	
				var query={"text":"","startTime":lastUpdate,"maxResults":10000};
		
				//clear the upload list
				uploadItems=[];
				
				//search all the recent history items
				chrome.history.search(query,function(historyItems) {
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
				});
			}
		});
	}
}

function findVisitItemByHistoryItem(historyItem) {
	for(var i=0;i<allVisitItems.length;i++) {
		var visitItem=allVisitItems[i];
		if(visitItem.id==historyItem.id && visitItem.visitTime==historyItem.lastVisitTime) return visitItem;
	}
	return null;
}


function findVisitItemByVisitId(visitId) {
	for(var i=0;i<allVisitItems.length;i++) {
		var visitItem=allVisitItems[i];
		if(visitItem.visitId==visitId) return visitItem;
	}
	return null;
}

function findHistoryItemById(id) {
	for(var i=0;i<allHistoryItems.length;i++) {
		var historyItem=allHistoryItems[i];
		if(historyItem.id==id) return historyItem;
	}
	return null;
}

function addChildren(visitId) {
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

			//for each one call addChildren(visitId), to get any children of this child
			addChildren(visitItem.visitId);
		}
	}
}

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
	
	//fill in chrome_urls and chrome_visits for this verified historyItem
	
	//add current url
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
	
	//get visit item
	var visitItem=findVisitItemByHistoryItem(historyItem);
	
	//add the visit for the current url
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

	//traverse down the visits table, to last leaf in tree from url 5579
	//recurse branches
	addChildren(visitItem.visitId);

	//traverse up the visits table to the first typed domain, and add associated urls and visits
	while(true) {
		var referringVisitId=visitItem.referringVisitId;
		//break if no parent
		if(referringVisitId=="0") break;
		
		//get parent visitItem
		visitItem=findVisitItemByVisitId(visitItem.referringVisitId);
		//break if parent not in list 
		if(!visitItem) break;

		//add the parent visit
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
//		"8635"
		historyItem=findHistoryItemById(visitItem.id);
		if(historyItem) {
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

function saveTree(callback) {
	var url="http://spade.ft1.us/save_tree.php";
	var url_tree_string=JSON.stringify(url_tree);
	console.log("saveTree():"+url_tree_string);
	
//	if(callback) callback(true); //for testing only
//	return; //for testing only
	
	var query="url_tree="+encodeURIComponent(url_tree)+"&user_token="+encodeURIComponent(token);
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
		console.log("verifying url:"+url);
		//item is wikipedia so look up the page and verify
		var req=new XMLHttpRequest();

		req.onreadystatechange=function(e) {
			if(req.readyState==4) {
				if(req.status==200) {
					try {
						//parse the wikipedia page
						var parser=new DOMParser();
						var doc=parser.parseFromString(req.responseText,"text/html");
						var wikiText=doc.body.textContent;
						
						//check the wiki text for key terms
						if(clinical_detect(wikiText)) {
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

		req.open("GET",url,true);
		req.send(null);
	}
}

function clinical_detect(wiki_text){

	var clinical_terms=
		[
		 "{{Infobox disease",
		 "{{Infobox anatomy",
		 "{{Infobox symptom",
		 "{{Infobox scientist",
		 "{{chembox",
		 "GraySubject",
		 "ICD10={{ICD10",
		 "ICD9={{ICD9",
		 "MedlinePlus=",
		 "eMedicineSubj=",
		 "eMedicineTopic",
		 "MeshNumber",
		 "DorlandsID",
		 "[[Category:Organs]]",
		 "{{Animal anatomy}}",
		 "MedlinePlus",
		 "[[Category:Symptoms and signs:",
		 "|geneid=",
		 "{{Human homeostasis}}",
		 "{{Blood tests}}",
		 "[[Category:Human homeostasis]]",
		 "[[Category:Blood",
		 "{{Expert-subject|Medicine",
		 "eMedicineTopic",
		 "{{MeshName",
		 "{{Major drug groups}}",
		 "{{Chromosome genetics}}",
		 "{{Biology nav}}",
		 "[[Category:Auxology",
		 "[[Category:Anthropometry",
		 "[[Category:Immunology",
		 "[[Category:Autoimmune diseases",
		 "{{System and organs}}",
		 "{{Digestive glands}}",
		 "{{Endocrine system}}",
		 "{{endocrine_pancreas}}",
		 "[[Category:Human pregnancy",
		 "[[Category:Birth control",
		 "[[Category:Reproduction in mammals",
		 "[[Category:Obstetrics",
		 "[[Category:Fertility",
		 "{{Pregnancy",
		 "{{Reproductive health",
		 "{{Reproductive physiology",
		 "{{Humandevelopment",
		 "[[Category:Global health",
		 "pathology}}",
		 "[[Category:Cognition",
		 "{{Taxobox",
		 "{{Viral diseases",
		 "{{PBB",
		 "{{PDB Gallery",
		 "[[Category:Disability",
		 "[[Category:Podiatry",
		 "[[Category:Orthopedic braces",
		 "[[Category:Orthopedics",
		 "[[Category:Skeletal system",
		 "[[Category:Muscular system",
		 "[[Category:Rehabilitation team",
		 "[[Category:Orthopedic surgery",
		 "PubChem_Ref",
		 "ChemSpiderID",
		 "EINECS",
		 "KEGG_Ref",
		 "ChEMBL",
		 "ATCCode_",
		 "StdInChI",
		 "{{Biology",
		 "{{Biochemical",
		 "{{Infobox particle",
		 "[[Category:Chemical elements",
		 "[[Category:Drugs",
		 "{{MolBioGeneExp",
		 "{{Nucleic acids",
		 "{{Genetics",
		 "[[Category:DNA",
		 "[[Category:Genetics",
		 "[[Category:Oaths of medicine",
		 "[[Category:Medical",
		 "[[Category:Philosophy of medicine",
		 "[[Category:Sequestering cells",
		 "[[Category:Human cells",
		 "proteins}}",
		 "[[Category:Keratins",
		 "[[Category:Cytoskeleton",
		 "[[Category:Skin",
		 "[[Category:Physiology",
		 "Molecular and cellular biology}}",
		 "[[Category:Ageing",
		 "[[Category:Cellular",
		 "[[Category:Gerontology",
		 "[[Category:Molecular",
		 "[[Category:Mutation",
		 "[[Category:DNA repair",
		 "[[Category:Senescence",
		 "{{Immune system",
		 "{{Lymphatic system",
		 "{{System and organs",
		 "{{Immune receptors",
		 "Biology|Medicine}}",
		 "Medicine|Biology}}",
		 "{{Diets",
		 "[[Category:Medical treatments",
		 "[[Category:Syndromes",
		 "[[Category:History of medicine",
		 "{{History of medicine",
		 "{{Protein topics",
		 "[[Category:Proteins",
		 "[[Category:Protein complexes",
		 "[[Category:Organelles",
		 "[[Category:Apoptosis",
		 "[[Category:Biology"
		 ];

	wiki_text=wiki_text.toLowerCase();
	for(var i=0;i<clinical_terms.length;i++) {
		var term=clinical_terms[i].toLowerCase();
		if(wiki_text.indexOf(term)>-1) {
			return true;
		}
	}
	
	return false;
}

init();