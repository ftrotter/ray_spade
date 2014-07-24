var idle,token,running=false,uploadItems,verifiedItems,lastUpdate,thisUpdate,processing=false;

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
				
				console.log("newState:"+newState);
				lastUpdate=parseFloat(localStorage.lastUpdate) || 0.0;
				thisUpdate=(new Date).getTime();	
				var query={"text":"","startTime":lastUpdate};
		
				//clear the upload list
				uploadItems=[];
				
				//search all the recent history items
				chrome.history.search(query,function(historyItems) {
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
							//upload verified items
							saveTree(function(result) {
								//store this update time, so that only items after now are processed
								//but only if successfully saved to server
								localStorage["lastUpdate"]=thisUpdate;  //comment out for testing of all links
							});
						}
						processing=false;
					});
				});
			}
		});
	}
}

function saveTree(callback) {
	var url="http://spade.ft1.us/save_tree.php";
	var url_tree=JSON.stringify(verifiedItems);
	console.log("saveTree():"+url_tree);
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