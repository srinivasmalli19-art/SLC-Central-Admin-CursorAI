/**
 * Built-in JeevaMitra crop safety cards, copied from the app
 * (jeevamitra-app/src/features/fields/cropGuides.defaults.js, v62).
 * The app shows these unless an admin edit in Firestore `cropGuides/{id}`
 * overrides a field. Shown here so admins can see and edit the current text.
 * If the app defaults change, regenerate this file.
 */
export type Localized = { en: string; te: string; hi: string };
export interface CropDefault {
  id: string;
  emoji: string;
  order: number;
  basis: string;
  name: Localized;
  goodFor: Localized;
  risk: Localized;
  precautions: Localized;
}

export const DEFAULT_CROPS: CropDefault[] = [
  {
    "id": "paddy",
    "emoji": "🌾",
    "order": 1,
    "basis": "sourced",
    "name": {
      "en": "Paddy",
      "te": "వరి",
      "hi": "धान"
    },
    "goodFor": {
      "en": "Main dry fodder for cattle and buffaloes.",
      "te": "ఆవులు, గేదెలకు ముఖ్యమైన ఎండు మేత.",
      "hi": "गाय-भैंस के लिए मुख्य सूखा चारा।"
    },
    "risk": {
      "en": "Very low in protein and hard to digest, so animals fed only straw lose condition. Its oxalate causes calcium loss. Wet or mouldy straw can cause Degnala disease in buffaloes: swollen legs, and the ears and tail start to rot.",
      "te": "ఇందులో మాంసకృత్తులు (ప్రొటీన్) చాలా తక్కువ, అరగడం కష్టం. కేవలం గడ్డి మాత్రమే పెడితే పశువులు బలహీనపడతాయి. ఇందులోని ఆక్సలేట్ వల్ల శరీరంలో కాల్షియం తగ్గుతుంది. తడిసిన లేదా బూజు పట్టిన గడ్డి తింటే గేదెలకు 'డెగ్నాలా' వ్యాధి వస్తుంది: కాళ్లు వాచి, చెవులు, తోక కుళ్లిపోతాయి.",
      "hi": "इसमें प्रोटीन बहुत कम होता है और यह मुश्किल से पचता है, इसलिए केवल पुआल खाने पर पशु कमज़ोर हो जाते हैं। इसमें मौजूद ऑक्सलेट से शरीर में कैल्शियम घटता है। गीला या फफूंद लगा पुआल खाने से भैंसों में 'डेगनाला' रोग होता है: पैर सूज जाते हैं और कान, पूँछ सड़ने लगते हैं।"
    },
    "precautions": {
      "en": "Give green fodder or pulse straw along with it, and a mineral mixture with calcium. Never feed wet or mouldy straw. Urea-treated straw is more nutritious; ask your vet.",
      "te": "దీనితో పాటు పచ్చి మేత లేదా పప్పుధాన్యాల గడ్డి, కాల్షియం ఉన్న ఖనిజ లవణ మిశ్రమం ఇవ్వండి. తడిసిన, బూజు పట్టిన గడ్డి ఎప్పుడూ పెట్టకండి. యూరియాతో శుద్ధి చేసిన గడ్డి మరింత పోషకమైనది; మీ పశువైద్యుడిని అడగండి.",
      "hi": "इसके साथ हरा चारा या दलहन का भूसा और कैल्शियम वाला खनिज मिश्रण दें। गीला या फफूंद लगा पुआल कभी न खिलाएँ। यूरिया से उपचारित पुआल अधिक पौष्टिक होता है; अपने पशु चिकित्सक से पूछें।"
    }
  },
  {
    "id": "jowar",
    "emoji": "🌾",
    "order": 2,
    "basis": "sourced",
    "name": {
      "en": "Jowar (sorghum)",
      "te": "జొన్న",
      "hi": "ज्वार"
    },
    "goodFor": {
      "en": "Good dry fodder after harvest.",
      "te": "కోత తర్వాత మంచి ఎండు మేత.",
      "hi": "कटाई के बाद अच्छा सूखा चारा।"
    },
    "risk": {
      "en": "Fresh green shoots that grow again in the stubble, especially after drought, frost or trampling, can release cyanide. Animals can die within minutes to hours. The stalks can also hold nitrate.",
      "te": "కోత తర్వాత మొదళ్ల నుంచి మళ్లీ వచ్చే లేత పచ్చి చిగుళ్లలో, ముఖ్యంగా బెట్ట, మంచు లేదా తొక్కబడిన తర్వాత, సైనైడ్ విషం ఏర్పడవచ్చు. పశువులు కొన్ని నిమిషాల నుంచి గంటల్లో చనిపోవచ్చు. కాండాల్లో నైట్రేట్ కూడా ఉండవచ్చు.",
      "hi": "ठूँठ से दोबारा निकलने वाले हरे कोमल कल्लों में, खासकर सूखे, पाले या कुचले जाने के बाद, साइनाइड ज़हर बन सकता है। पशु कुछ मिनटों से घंटों में मर सकते हैं। डंठलों में नाइट्रेट भी हो सकता है।"
    },
    "precautions": {
      "en": "Do not let hungry animals onto stubble with green regrowth; feed them first. If any animal breathes fast, froths at the mouth or staggers, move all animals out and call a vet at once.",
      "te": "పచ్చి చిగుళ్లు ఉన్న జొన్న మొదళ్లలోకి ఆకలితో ఉన్న పశువులను వదలకండి; ముందుగా మేత పెట్టి వదలండి. ఏ పశువైనా వేగంగా శ్వాస తీసుకుంటున్నా, నోటి నుంచి నురగ వస్తున్నా, తూలుతున్నా వెంటనే అన్ని పశువులను బయటకు తీసి పశువైద్యుడిని పిలవండి.",
      "hi": "हरे कल्लों वाले ज्वार के ठूँठ में भूखे पशुओं को न छोड़ें; पहले उन्हें चारा खिलाएँ। अगर कोई पशु तेज़ साँस ले, मुँह से झाग आए या लड़खड़ाए, तो तुरंत सभी पशुओं को बाहर निकालें और पशु चिकित्सक को बुलाएँ।"
    }
  },
  {
    "id": "maize",
    "emoji": "🌽",
    "order": 3,
    "basis": "sourced",
    "name": {
      "en": "Maize",
      "te": "మొక్కజొన్న",
      "hi": "मक्का"
    },
    "goodFor": {
      "en": "Good dry fodder.",
      "te": "మంచి ఎండు మేత.",
      "hi": "अच्छा सूखा चारा।"
    },
    "risk": {
      "en": "Eating many leftover cobs or spilled grain can cause grain overload: bloating, diarrhoea, lameness and death. Drought-hit or heavily fertilised stalks can hold nitrate, mostly in the lower stalk.",
      "te": "పొలంలో మిగిలిన కంకులు, రాలిన గింజలు ఎక్కువగా తింటే కడుపు ఉబ్బరం, విరేచనాలు, కుంటుతనం, మరణం సంభవించవచ్చు. బెట్టకు గురైన లేదా ఎక్కువ ఎరువు వేసిన మొక్కల కాండం కింది భాగంలో నైట్రేట్ ఉండవచ్చు.",
      "hi": "खेत में बचे भुट्टे और गिरा हुआ दाना ज़्यादा खाने से पेट फूलना, दस्त, लंगड़ापन और मौत हो सकती है। सूखे से प्रभावित या ज़्यादा खाद वाले पौधों के निचले डंठल में नाइट्रेट हो सकता है।"
    },
    "precautions": {
      "en": "Check the field for leftover cobs first. On the first days graze for short periods only. Do not graze drought-hit crops without your vet's advice.",
      "te": "ముందుగా పొలంలో మిగిలిన కంకులు ఉన్నాయేమో చూడండి. మొదటి రోజుల్లో కొద్దిసేపు మాత్రమే మేపండి. బెట్టకు గురైన పంటను పశువైద్యుడి సలహా లేకుండా మేపకండి.",
      "hi": "पहले खेत में बचे भुट्टे देख लें। शुरू के दिनों में थोड़ी देर ही चराएँ। सूखे से प्रभावित फसल को पशु चिकित्सक की सलाह के बिना न चराएँ।"
    }
  },
  {
    "id": "bajra",
    "emoji": "🌾",
    "order": 4,
    "basis": "sourced",
    "name": {
      "en": "Bajra (pearl millet)",
      "te": "సజ్జ",
      "hi": "बाजरा"
    },
    "goodFor": {
      "en": "Dry fodder.",
      "te": "ఎండు మేత.",
      "hi": "सूखा चारा।"
    },
    "risk": {
      "en": "Drought-stressed or heavily fertilised plants can hold nitrate: brown gums, fast breathing, sudden death, and abortion in pregnant animals.",
      "te": "బెట్టకు గురైన లేదా ఎక్కువ ఎరువు వేసిన మొక్కల్లో నైట్రేట్ ఉండవచ్చు: చిగుళ్లు గోధుమ రంగులోకి మారడం, వేగంగా శ్వాస, ఆకస్మిక మరణం, చూడి పశువుల్లో ఈసుకుపోవడం జరగవచ్చు.",
      "hi": "सूखे से प्रभावित या ज़्यादा खाद वाले पौधों में नाइट्रेट हो सकता है: मसूड़े भूरे पड़ना, तेज़ साँस, अचानक मौत और गाभिन पशुओं में गर्भपात।"
    },
    "precautions": {
      "en": "Avoid drought-hit fields. Give salt and a mineral mixture. Never let animals reach fertiliser bags.",
      "te": "బెట్టకు గురైన పొలాల్లో మేపకండి. ఉప్పు, ఖనిజ లవణ మిశ్రమం ఇవ్వండి. ఎరువుల సంచుల దగ్గరకు పశువులను వెళ్లనివ్వకండి.",
      "hi": "सूखे से प्रभावित खेतों में न चराएँ। नमक और खनिज मिश्रण दें। पशुओं को खाद की बोरियों तक न पहुँचने दें।"
    }
  },
  {
    "id": "groundnut",
    "emoji": "🥜",
    "order": 5,
    "basis": "sourced",
    "name": {
      "en": "Groundnut",
      "te": "వేరుశనగ",
      "hi": "मूंगफली"
    },
    "goodFor": {
      "en": "One of the best residues: rich in protein.",
      "te": "అత్యుత్తమ అవశేషాల్లో ఒకటి: మాంసకృత్తులు (ప్రొటీన్) ఎక్కువ.",
      "hi": "सबसे अच्छे अवशेषों में से एक: प्रोटीन भरपूर।"
    },
    "risk": {
      "en": "Haulms with small, immature pods still attached can carry aflatoxin, a mould poison that harms the liver and passes into milk.",
      "te": "తీగలకు అంటుకుని ఉన్న చిన్న, పూర్తిగా ఎదగని కాయల్లో అఫ్లాటాక్సిన్ అనే బూజు విషం ఉండవచ్చు. ఇది కాలేయాన్ని దెబ్బతీస్తుంది, పాలలోకి కూడా చేరుతుంది.",
      "hi": "बेलों से लगी छोटी, कच्ची फलियों में एफ़्लाटॉक्सिन नाम का फफूंद ज़हर हो सकता है, जो लीवर को नुकसान पहुँचाता है और दूध में भी आ जाता है।"
    },
    "precautions": {
      "en": "Use well-dried haulms. Remove immature pods. Never feed mouldy or rain-wet haulms.",
      "te": "బాగా ఎండిన తీగలనే వాడండి. ఎదగని కాయలను తీసేయండి. బూజు పట్టిన లేదా వర్షంలో తడిసిన తీగలను ఎప్పుడూ పెట్టకండి.",
      "hi": "अच्छी तरह सूखी बेलें ही दें। कच्ची फलियाँ हटा दें। फफूंद लगी या बारिश में भीगी बेलें कभी न खिलाएँ।"
    }
  },
  {
    "id": "bengalGram",
    "emoji": "🫘",
    "order": 6,
    "basis": "partly",
    "name": {
      "en": "Bengal gram (chickpea)",
      "te": "శనగ",
      "hi": "चना"
    },
    "goodFor": {
      "en": "Its straw has a little more protein than cereal straw.",
      "te": "దీని పొట్టులో ధాన్యపు గడ్డి కంటే కొంచెం ఎక్కువ మాంసకృత్తులు ఉంటాయి.",
      "hi": "इसके भूसे में अनाज के भूसे से थोड़ा ज़्यादा प्रोटीन होता है।"
    },
    "risk": {
      "en": "Low in protein (about 5%) and lower in energy than other pulse straws. Some reports mention high oxalic acid, but studies have not confirmed it.",
      "te": "మాంసకృత్తులు తక్కువ (సుమారు 5%), ఇతర పప్పుధాన్యాల గడ్డి కంటే శక్తి తక్కువ. ఇందులో ఆక్సాలిక్ ఆమ్లం ఎక్కువని కొన్ని నివేదికలు చెబుతున్నా, పరిశోధనల్లో అది నిర్ధారణ కాలేదు.",
      "hi": "प्रोटीन कम (लगभग 5%) और दूसरे दलहन भूसों से ऊर्जा कम। कुछ रिपोर्टों में ऑक्सालिक अम्ल ज़्यादा होने की बात है, पर शोध में इसकी पुष्टि नहीं हुई।"
    },
    "precautions": {
      "en": "Give green fodder and a mineral mixture along with it. Check the spray date: chickpea is often sprayed for pod borer.",
      "te": "దీనితో పాటు పచ్చి మేత, ఖనిజ లవణ మిశ్రమం ఇవ్వండి. పిచికారీ తేదీ చూడండి: శనగకు కాయ తొలిచే పురుగు కోసం తరచూ మందు కొడతారు.",
      "hi": "इसके साथ हरा चारा और खनिज मिश्रण दें। छिड़काव की तारीख देखें: चने पर फली छेदक के लिए अक्सर दवा छिड़की जाती है।"
    }
  },
  {
    "id": "redGram",
    "emoji": "🫘",
    "order": 7,
    "basis": "vet",
    "name": {
      "en": "Red gram",
      "te": "కంది",
      "hi": "अरहर (तुअर)"
    },
    "goodFor": {
      "en": "Leaves and pod husk are useful feed.",
      "te": "ఆకులు, కాయ పొట్టు మంచి మేత.",
      "hi": "पत्तियाँ और फली का छिलका काम का चारा हैं।"
    },
    "risk": {
      "en": "Hard, woody stalks are poorly digested.",
      "te": "గట్టి, కర్రలాంటి కాండాలు సరిగా అరగవు.",
      "hi": "सख़्त, लकड़ी जैसे डंठल ठीक से नहीं पचते।"
    },
    "precautions": {
      "en": "Let animals eat the leaves and husk; do not rely on stalks alone.",
      "te": "ఆకులు, పొట్టు తిననివ్వండి; కేవలం కాండాలపై ఆధారపడకండి.",
      "hi": "पत्तियाँ और छिलका खाने दें; सिर्फ़ डंठलों के भरोसे न रहें।"
    }
  },
  {
    "id": "blackGram",
    "emoji": "🫘",
    "order": 8,
    "basis": "vet",
    "name": {
      "en": "Black gram",
      "te": "మినుము",
      "hi": "उड़द"
    },
    "goodFor": {
      "en": "Good pulse fodder.",
      "te": "మంచి పప్పుధాన్యాల మేత.",
      "hi": "अच्छा दलहनी चारा।"
    },
    "risk": {
      "en": "Eating a lot of lush green regrowth may cause bloat.",
      "te": "లేతగా, పచ్చగా తిరిగి పెరిగిన మొక్కలు ఎక్కువగా తింటే కడుపు ఉబ్బరం రావచ్చు.",
      "hi": "हरे-भरे कोमल पौधे ज़्यादा खाने से पेट फूल सकता है।"
    },
    "precautions": {
      "en": "Introduce slowly and check the spray date.",
      "te": "నెమ్మదిగా అలవాటు చేయండి, పిచికారీ తేదీ చూడండి.",
      "hi": "धीरे-धीरे आदत डालें और छिड़काव की तारीख देखें।"
    }
  },
  {
    "id": "greenGram",
    "emoji": "🫘",
    "order": 9,
    "basis": "vet",
    "name": {
      "en": "Green gram",
      "te": "పెసర",
      "hi": "मूंग"
    },
    "goodFor": {
      "en": "Good pulse fodder.",
      "te": "మంచి పప్పుధాన్యాల మేత.",
      "hi": "अच्छा दलहनी चारा।"
    },
    "risk": {
      "en": "Eating a lot of lush green regrowth may cause bloat.",
      "te": "లేతగా, పచ్చగా తిరిగి పెరిగిన మొక్కలు ఎక్కువగా తింటే కడుపు ఉబ్బరం రావచ్చు.",
      "hi": "हरे-भरे कोमल पौधे ज़्यादा खाने से पेट फूल सकता है।"
    },
    "precautions": {
      "en": "Introduce slowly and check the spray date.",
      "te": "నెమ్మదిగా అలవాటు చేయండి, పిచికారీ తేదీ చూడండి.",
      "hi": "धीरे-धीरे आदत डालें और छिड़काव की तारीख देखें।"
    }
  },
  {
    "id": "horseGram",
    "emoji": "🫘",
    "order": 10,
    "basis": "vet",
    "name": {
      "en": "Horse gram",
      "te": "ఉలవలు",
      "hi": "कुलथी"
    },
    "goodFor": {
      "en": "Good pulse residue.",
      "te": "మంచి పప్పుధాన్యపు అవశేషం.",
      "hi": "अच्छा दलहनी अवशेष।"
    },
    "risk": {
      "en": "No specific risks are documented yet. Ask your vet.",
      "te": "ప్రత్యేక ప్రమాదాలు ఇంకా నమోదు కాలేదు. మీ పశువైద్యుడిని అడగండి.",
      "hi": "अभी कोई खास ख़तरा दर्ज नहीं है। अपने पशु चिकित्सक से पूछें।"
    },
    "precautions": {
      "en": "Introduce slowly over several days.",
      "te": "కొన్ని రోజుల్లో నెమ్మదిగా అలవాటు చేయండి.",
      "hi": "कुछ दिनों में धीरे-धीरे आदत डालें।"
    }
  },
  {
    "id": "cotton",
    "emoji": "☁️",
    "order": 11,
    "basis": "sourced",
    "name": {
      "en": "Cotton",
      "te": "పత్తి",
      "hi": "कपास"
    },
    "goodFor": {
      "en": "Sheep and goats graze the leaves and leftover bolls after picking.",
      "te": "పత్తి ఏరిన తర్వాత గొర్రెలు, మేకలు ఆకులను, మిగిలిన కాయలను మేస్తాయి.",
      "hi": "चुनाई के बाद भेड़-बकरियाँ पत्तियाँ और बचे हुए टिंडे चरती हैं।"
    },
    "risk": {
      "en": "Cotton plants and seeds contain gossypol, which builds up in the body over time and can damage the heart; lambs and kids are most at risk. Cotton is heavily sprayed: after sheep deaths in Warangal, Khammam and Adilabad, tests on cotton plants found nitrates, cyanide and pesticide.",
      "te": "పత్తి మొక్కల్లో, గింజల్లో గాసిపాల్ అనే విషపదార్థం ఉంటుంది. ఇది రోజులు గడిచే కొద్దీ శరీరంలో పేరుకుపోయి గుండెను దెబ్బతీయవచ్చు; గొర్రె పిల్లలు, మేక పిల్లలకు ప్రమాదం ఎక్కువ. పత్తికి మందులు ఎక్కువగా కొడతారు: వరంగల్, ఖమ్మం, ఆదిలాబాద్‌లో గొర్రెలు చనిపోయిన తర్వాత పత్తి మొక్కలను పరీక్షిస్తే నైట్రేట్లు, సైనైడ్, పురుగుమందు అవశేషాలు కనిపించాయి.",
      "hi": "कपास के पौधों और बिनौले में गॉसिपोल नाम का ज़हरीला तत्व होता है, जो समय के साथ शरीर में जमा होकर दिल को नुकसान पहुँचा सकता है; मेमनों और बकरी के बच्चों को सबसे ज़्यादा ख़तरा है। कपास पर बहुत दवा छिड़की जाती है: वरंगल, खम्मम और आदिलाबाद में भेड़ों की मौत के बाद कपास के पौधों की जाँच में नाइट्रेट, साइनाइड और कीटनाशक मिले।"
    },
    "precautions": {
      "en": "Wait well after the last spray (the owner must give the date). At first graze only a few hours a day, and not every day for weeks. Keep lambs and kids off. Call a vet at the first sign of illness.",
      "te": "చివరి పిచికారీ తర్వాత తగినంత కాలం ఆగండి (యజమాని తేదీ తప్పక చెప్పాలి). మొదట్లో రోజుకు కొన్ని గంటలు మాత్రమే మేపండి, వారాల తరబడి ప్రతిరోజూ మేపకండి. గొర్రె పిల్లలు, మేక పిల్లలను దూరంగా ఉంచండి. అనారోగ్య లక్షణం కనిపించగానే పశువైద్యుడిని పిలవండి.",
      "hi": "आख़िरी छिड़काव के बाद काफ़ी दिन रुकें (मालिक तारीख ज़रूर बताए)। शुरू में दिन में कुछ घंटे ही चराएँ, और हफ़्तों तक रोज़ न चराएँ। मेमनों और बकरी के बच्चों को दूर रखें। बीमारी का पहला लक्षण दिखते ही पशु चिकित्सक को बुलाएँ।"
    }
  },
  {
    "id": "chilli",
    "emoji": "🌶️",
    "order": 12,
    "basis": "vet",
    "name": {
      "en": "Chilli",
      "te": "మిర్చి",
      "hi": "मिर्च"
    },
    "goodFor": {
      "en": "Low feed value; sometimes grazed after picking.",
      "te": "పోషక విలువ తక్కువ; కోత తర్వాత కొన్నిసార్లు మేపుతారు.",
      "hi": "पोषण कम; तुड़ाई के बाद कभी-कभी चराया जाता है।"
    },
    "risk": {
      "en": "Effects on livestock are not documented. Chilli is often sprayed heavily.",
      "te": "పశువులపై ప్రభావం గురించి సమాచారం నమోదు కాలేదు. మిర్చికి తరచూ ఎక్కువగా మందులు కొడతారు.",
      "hi": "पशुओं पर असर के बारे में जानकारी दर्ज नहीं है। मिर्च पर अक्सर बहुत दवा छिड़की जाती है।"
    },
    "precautions": {
      "en": "Check the spray date carefully and graze only for short periods.",
      "te": "పిచికారీ తేదీని జాగ్రత్తగా చూడండి, కొద్దిసేపు మాత్రమే మేపండి.",
      "hi": "छिड़काव की तारीख ध्यान से देखें और थोड़ी देर ही चराएँ।"
    }
  },
  {
    "id": "sunflower",
    "emoji": "🌻",
    "order": 13,
    "basis": "vet",
    "name": {
      "en": "Sunflower",
      "te": "పొద్దుతిరుగుడు",
      "hi": "सूरजमुखी"
    },
    "goodFor": {
      "en": "Heads and leaves are eaten.",
      "te": "పువ్వు తలలు, ఆకులను పశువులు తింటాయి.",
      "hi": "पशु फूल के सिर और पत्तियाँ खाते हैं।"
    },
    "risk": {
      "en": "No specific risks are documented yet. Ask your vet.",
      "te": "ప్రత్యేక ప్రమాదాలు ఇంకా నమోదు కాలేదు. మీ పశువైద్యుడిని అడగండి.",
      "hi": "अभी कोई खास ख़तरा दर्ज नहीं है। अपने पशु चिकित्सक से पूछें।"
    },
    "precautions": {
      "en": "Introduce slowly over several days.",
      "te": "కొన్ని రోజుల్లో నెమ్మదిగా అలవాటు చేయండి.",
      "hi": "कुछ दिनों में धीरे-धीरे आदत डालें।"
    }
  },
  {
    "id": "sugarcane",
    "emoji": "🌿",
    "order": 14,
    "basis": "vet",
    "name": {
      "en": "Sugarcane tops",
      "te": "చెరకు ఆకు",
      "hi": "गन्ने का अगोला"
    },
    "goodFor": {
      "en": "Common green fodder after harvest.",
      "te": "కోత తర్వాత సాధారణంగా వాడే పచ్చి మేత.",
      "hi": "कटाई के बाद आम हरा चारा।"
    },
    "risk": {
      "en": "No specific risks are documented yet. Ask your vet.",
      "te": "ప్రత్యేక ప్రమాదాలు ఇంకా నమోదు కాలేదు. మీ పశువైద్యుడిని అడగండి.",
      "hi": "अभी कोई खास ख़तरा दर्ज नहीं है। अपने पशु चिकित्सक से पूछें।"
    },
    "precautions": {
      "en": "Feed with a mineral mixture.",
      "te": "ఖనిజ లవణ మిశ్రమంతో కలిపి ఇవ్వండి.",
      "hi": "खनिज मिश्रण के साथ खिलाएँ।"
    }
  }
];

export const DEFAULT_CROP_SETTINGS = {
  "sprayWarningDays": 21,
  "generalPrecautions": {
    "en": [
      "Feed animals before turning them onto a field; hungry animals eat too much too fast.",
      "Start with short grazing (1–2 hours) and increase over several days.",
      "Make sure clean drinking water is available.",
      "Check the last pesticide spray date. If it is unknown, ask the owner before grazing.",
      "Never let animals reach fertiliser bags, pesticide containers or mouldy fodder.",
      "Give a mineral mixture and salt during residue grazing.",
      "If animals breathe fast, froth at the mouth, stagger, bloat or collapse, move all animals off the field and call a vet immediately."
    ],
    "te": [
      "పొలంలోకి వదిలే ముందు పశువులకు మేత పెట్టండి; ఆకలితో ఉన్న పశువులు తొందరగా ఎక్కువగా తినేస్తాయి.",
      "మొదట కొద్దిసేపు (1–2 గంటలు) మేపి, కొన్ని రోజుల్లో నెమ్మదిగా సమయం పెంచండి.",
      "శుభ్రమైన తాగునీరు అందుబాటులో ఉండేలా చూడండి.",
      "చివరి పురుగుమందు పిచికారీ తేదీ చూడండి. తెలియకపోతే మేపే ముందు యజమానిని అడగండి.",
      "ఎరువుల సంచులు, పురుగుమందు డబ్బాలు, బూజు పట్టిన మేత దగ్గరకు పశువులను ఎప్పుడూ వెళ్లనివ్వకండి.",
      "అవశేషాలు మేపే రోజుల్లో ఖనిజ లవణ మిశ్రమం, ఉప్పు ఇవ్వండి.",
      "పశువులు వేగంగా శ్వాస తీసుకున్నా, నోటి నుంచి నురగ వచ్చినా, తూలినా, కడుపు ఉబ్బినా లేదా పడిపోయినా వెంటనే అన్ని పశువులను పొలం నుంచి బయటకు తీసి పశువైద్యుడిని పిలవండి."
    ],
    "hi": [
      "खेत में छोड़ने से पहले पशुओं को चारा खिलाएँ; भूखे पशु जल्दी-जल्दी बहुत ज़्यादा खा लेते हैं।",
      "पहले थोड़ी देर (1–2 घंटे) चराएँ और कुछ दिनों में धीरे-धीरे समय बढ़ाएँ।",
      "साफ़ पीने का पानी उपलब्ध रखें।",
      "आख़िरी कीटनाशक छिड़काव की तारीख देखें। पता न हो तो चराने से पहले मालिक से पूछें।",
      "पशुओं को खाद की बोरियों, कीटनाशक के डिब्बों या फफूंद लगे चारे तक कभी न पहुँचने दें।",
      "अवशेष चराई के दिनों में खनिज मिश्रण और नमक दें।",
      "अगर पशु तेज़ साँस लें, मुँह से झाग आए, लड़खड़ाएँ, पेट फूले या गिर पड़ें, तो तुरंत सभी पशुओं को खेत से बाहर निकालें और पशु चिकित्सक को बुलाएँ।"
    ]
  },
  "callVet": {
    "en": "Call a vet immediately if an animal breathes fast, froths at the mouth, staggers, bloats or collapses.",
    "te": "పశువు వేగంగా శ్వాస తీసుకున్నా, నోటి నుంచి నురగ వచ్చినా, తూలినా, కడుపు ఉబ్బినా లేదా పడిపోయినా వెంటనే పశువైద్యుడిని పిలవండి.",
    "hi": "अगर पशु तेज़ साँस ले, मुँह से झाग आए, लड़खड़ाए, पेट फूले या गिर पड़े, तो तुरंत पशु चिकित्सक को बुलाएँ।"
  },
  "disclaimer": {
    "en": "General guidance only. Ask your veterinarian for advice for your animals.",
    "te": "ఇది సాధారణ సమాచారం మాత్రమే. మీ పశువుల కోసం మీ పశువైద్యుడి సలహా తీసుకోండి.",
    "hi": "यह केवल सामान्य जानकारी है। अपने पशुओं के लिए पशु चिकित्सक से सलाह लें।"
  }
};
