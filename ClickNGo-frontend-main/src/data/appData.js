export const CATEGORIES = [
  { id:"grooming", label:"Grooming", icon:"/images/GR.png", color:"#9b59b6", bg:"rgba(155,89,182,0.15)",
    subs:["Hair & Styling","Spa Services","Nail Care","Beard Trim","Hair Colour","Massage"] },
  { id:"realestate", label:"Real Estate", icon:"/images/RE.png", color:"#27ae60", bg:"rgba(39,174,96,0.15)",
    subs:["Residential","Commercial","Rental","Property Valuation","Legal Aid","Interior Design"] },
  { id:"healthcare", label:"HealthCare", icon:"/images/HC.png", color:"#2980b9", bg:"rgba(41,128,185,0.15)",
    subs:["Dental Care","Physical Therapy","Medicines","General Physician","Eye Care","Lab Tests"] },
  { id:"sports", label:"Sports & Gaming", icon:"/images/SG.png", color:"#8e44ad", bg:"rgba(142,68,173,0.15)",
    subs:["Gaming Hubs","Turfs","Arcade Parlour","Cricket Ground","Badminton Court","Swimming Pool"] },
];

export const PROVIDERS = {
  grooming:[
    {id:1,name:"Standard Salon",sub:"Hair & Beauty",rating:4.2,reviews:138,dist:"5.3km",time:"10am–8pm",price:299,icon:"SS",tags:["Hair-cut","Styling","Beard"]},
    {id:2,name:"Glow Spa Studio",sub:"Spa & Wellness",rating:4.7,reviews:214,dist:"2.1km",time:"9am–9pm",price:599,icon:"GS",tags:["Massage","Facial","Scrub"]},
    {id:3,name:"Nail Artistry",sub:"Nail Care",rating:4.5,reviews:89,dist:"3.8km",time:"10am–7pm",price:349,icon:"NA",tags:["Manicure","Pedicure","Art"]},
    {id:4,name:"The Barber's Bench",sub:"Barbershop",rating:4.9,reviews:312,dist:"1.2km",time:"8am–8pm",price:199,icon:"BB",tags:["Shave","Cut","Beard"]},
  ],
  realestate:[
    {id:5,name:"Prime Properties",sub:"Residential Sales",rating:4.6,reviews:87,dist:"4.5km",time:"9am–6pm",price:0,icon:"PP",tags:["Buy","Sell","Rent"]},
    {id:6,name:"Urban Spaces Co.",sub:"Commercial Real Estate",rating:4.3,reviews:45,dist:"2.9km",time:"10am–7pm",price:0,icon:"US",tags:["Office","Shop","Warehouse"]},
    {id:7,name:"HomeFinder Plus",sub:"Rental Services",rating:4.8,reviews:193,dist:"1.7km",time:"9am–8pm",price:0,icon:"HF",tags:["Apartments","PG","Villa"]},
  ],
  healthcare:[
    {id:8,name:"SmileCare Dental",sub:"Dental Clinic",rating:4.7,reviews:156,dist:"3.2km",time:"9am–7pm",price:499,icon:"SD",tags:["Cleaning","Braces","Implant"]},
    {id:9,name:"PhysioFit Centre",sub:"Physical Therapy",rating:4.5,reviews:98,dist:"4.1km",time:"7am–9pm",price:699,icon:"PF",tags:["Rehab","Sports","Pain"]},
    {id:10,name:"QuickMeds Pharmacy",sub:"Medicines & Lab",rating:4.4,reviews:234,dist:"0.8km",time:"24/7",price:0,icon:"QM",tags:["Medicines","Tests","Reports"]},
  ],
  sports:[
    {id:11,name:"GameZone Hub",sub:"Gaming Centre",rating:4.8,reviews:412,dist:"2.3km",time:"10am–12am",price:149,icon:"GZ",tags:["PS5","PC","VR"]},
    {id:12,name:"GreenTurf Arena",sub:"Football & Cricket",rating:4.6,reviews:178,dist:"3.5km",time:"6am–10pm",price:399,icon:"GT",tags:["Football","Cricket","Hockey"]},
    {id:13,name:"Retro Arcade Palace",sub:"Arcade Gaming",rating:4.3,reviews:95,dist:"5.1km",time:"11am–11pm",price:99,icon:"RA",tags:["Arcade","Billiards","Air Hockey"]},
  ],
};

export const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
export const DAYS_SHORT = ["Su","Mo","Tu","We","Th","Fr","Sa"];

export const RECENT_BOOKINGS = [
  {service:"Haircut & Styling",provider:"Standard Salon",date:"Jan 15, 2024",status:"completed",icon:"HS"},
  {service:"Full Body Massage",provider:"Wellness Spa",date:"Jan 10, 2024",status:"completed",icon:"BM"},
  {service:"Manicure",provider:"Beauty Studio",date:"Jan 5, 2024",status:"cancelled",icon:"MN"},
  {service:"Gaming Session",provider:"GameZone Hub",date:"Dec 28, 2023",status:"completed",icon:"GS"},
];

export const REVIEWS = [
  {name:"Priya Sharma",rating:5,text:"Absolutely loved the experience! Booking was seamless and the salon was top-notch. Will definitely return.",date:"Mar 12, 2024",avatar:"PS"},
  {name:"Rahul Verma",rating:4,text:"Great platform. Saved me so much time. The real-time calendar is a game changer for busy people like me.",date:"Mar 8, 2024",avatar:"RV"},
  {name:"Ananya Singh",rating:5,text:"The GameZone Hub booking via ClicknGo was super easy. Instant confirmation and no waiting!",date:"Feb 28, 2024",avatar:"AS"},
  {name:"Arjun Mehta",rating:4,text:"Very convenient. Found a dentist near me in minutes. The review system helped me choose the right one.",date:"Feb 20, 2024",avatar:"AM"},
];

export function getSlots(date) {
  if(!date) return [];
  const dow = date.getDay();
  if(dow===0) return [];
  const d = date.getDate();
  return [
    {t:"10:00 AM",a:true},{t:"10:45 AM",a:d%3!==0},{t:"11:30 AM",a:true},
    {t:"12:15 PM",a:d%4!==1},{t:"02:00 PM",a:true},{t:"03:00 PM",a:d%2===0},
    {t:"04:30 PM",a:true},{t:"05:30 PM",a:d%5!==2},{t:"06:30 PM",a:d%3!==1},
  ].map(s=> d%7===0 ? {...s,a:false} : s);
}
