export const STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;0,900;1,700&family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500;600&display=swap');

:root {
  --yellow: #f2c94c;
  --yellow2: #e4b63f;
  --yellow-dim: rgba(242,201,76,0.16);
  --yellow-glow: rgba(242,201,76,0.24);
  --black: #ffffff;
  --black2: #f7f8fa;
  --black3: #edf1f5;
  --white: #1c2430;
  --off: #ffffff;
  --gray-bg: #f3f5f8;
  --gray-line: #d8dee7;
  --gray-mid: #5d6775;
  --gray-text: #7b8696;
  --green: #22c55e;
  --green-dim: rgba(34,197,94,0.15);
  --red: #ef4444;
  --red-dim: rgba(239,68,68,0.15);
  --blue: #3b82f6;

  /* Liquid Glass */
  --glass: rgba(255,255,255,0.10);
  --glass-strong: rgba(255,255,255,0.16);
  --glass-border: rgba(255,255,255,0.22);
  --glass-border-strong: rgba(255,255,255,0.35);
  --glass-shadow: 0 8px 40px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.18);
  --glass-blur: blur(22px) saturate(200%);

  --r: 36px;
  --r-sm: 18px;
  --ease: cubic-bezier(0.22,1,0.36,1);
}

*{margin:0;padding:0;box-sizing:border-box;}
html{scroll-behavior:smooth;}
body{
  font-family:'DM Sans',sans-serif;
  background:
    radial-gradient(1200px 500px at -10% -20%, rgba(255,255,255,0.95), transparent 60%),
    radial-gradient(900px 420px at 110% -10%, rgba(232,238,247,0.55), transparent 58%),
    linear-gradient(180deg,#f6f8fc 0%, #edf2f8 100%);
  color:var(--white);
  min-height:100vh;
  overflow-x:hidden;
}
input,textarea,select{font-family:'DM Sans',sans-serif;}
button{font-family:'DM Sans',sans-serif;cursor:pointer;}

/* GLASS */
.glass{
  background:linear-gradient(160deg, rgba(255,255,255,0.72), rgba(255,255,255,0.45));
  border:1px solid rgba(255,255,255,0.72);
  box-shadow:0 16px 34px rgba(17,24,39,0.09), inset 0 1px 0 rgba(255,255,255,0.95);
  backdrop-filter:blur(22px) saturate(150%);
  -webkit-backdrop-filter:blur(22px) saturate(150%);
}
.glass-strong{
  background:linear-gradient(160deg, rgba(255,255,255,0.85), rgba(255,255,255,0.58));
  border:1px solid rgba(255,255,255,0.82);
  box-shadow:0 18px 40px rgba(17,24,39,0.1), inset 0 1px 0 rgba(255,255,255,0.98);
  backdrop-filter:blur(24px) saturate(170%);
  -webkit-backdrop-filter:blur(24px) saturate(170%);
}
.glass-card{
  background:linear-gradient(165deg, rgba(255,255,255,0.8), rgba(255,255,255,0.56));
  border:1px solid rgba(255,255,255,0.8);
  box-shadow:0 18px 44px rgba(17,24,39,0.12), inset 0 1px 0 rgba(255,255,255,0.98);
  backdrop-filter:blur(26px) saturate(170%);
  -webkit-backdrop-filter:blur(26px) saturate(170%);
  border-radius:var(--r);
  transition:transform .5s var(--ease), box-shadow .5s var(--ease), border-color .5s var(--ease);
}
.glass-yellow{
  background:rgba(255,224,51,0.10);
  backdrop-filter:blur(20px) saturate(180%);
  -webkit-backdrop-filter:blur(20px) saturate(180%);
  border:1px solid rgba(255,224,51,0.25);
  box-shadow:0 4px 24px rgba(255,224,51,0.1);
}

/* SCROLL */
::-webkit-scrollbar{width:5px;height:5px;}
::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:99px;}

/* ANIMATIONS */
@keyframes fadeUp{
  from{opacity:0;transform:translateY(18px);}
  to{opacity:1;transform:translateY(0);}
}
@keyframes fadeIn{
  from{opacity:0;}
  to{opacity:1;}
}
@keyframes scaleIn{
  from{opacity:0;transform:scale(0.93);}
  to{opacity:1;transform:scale(1);}
}
@keyframes spin{to{transform:rotate(360deg);}}
@keyframes float{
  0%,100%{transform:translateY(0) rotate(0deg);}
  50%{transform:translateY(-20px) rotate(3deg);}
}
@keyframes pulse{
  0%,100%{opacity:1;transform:scale(1);}
  50%{opacity:0.6;transform:scale(0.97);}
}
@keyframes slideIn{
  from{transform:translateX(-100%);}
  to{transform:translateX(0);}
}
@keyframes shimmer{
  0%{background-position:-200% 0;}
  100%{background-position:200% 0;}
}
@keyframes liquidBlob{
  0%,100%{border-radius:60% 40% 30% 70% / 60% 30% 70% 40%;}
  25%{border-radius:30% 60% 70% 40% / 50% 60% 30% 60%;}
  50%{border-radius:50% 60% 30% 60% / 30% 40% 70% 60%;}
  75%{border-radius:60% 40% 60% 30% / 60% 70% 30% 40%;}
}
@keyframes toastIn{
  from{opacity:0;transform:translateX(-50%) translateY(20px);}
  to{opacity:1;transform:translateX(-50%) translateY(0);}
}

.animate-fade-up{animation:fadeUp 0.8s var(--ease) both;}
.animate-fade-in{animation:fadeIn 0.7s var(--ease) both;}
.animate-scale{animation:scaleIn 0.7s var(--ease) both;}

/* STAGGER DELAYS */
.d1{animation-delay:.05s!important;}
.d2{animation-delay:.1s!important;}
.d3{animation-delay:.15s!important;}
.d4{animation-delay:.2s!important;}
.d5{animation-delay:.25s!important;}
.d6{animation-delay:.3s!important;}

/* TOAST */
.toast{
  position:fixed;bottom:32px;left:50%;
  transform:translateX(-50%) translateY(20px);
  background:rgba(10,10,15,0.9);
  backdrop-filter:blur(20px);
  border:1px solid rgba(255,224,51,0.3);
  color:#fff;
  padding:14px 28px;
  border-radius:999px;
  font-size:14px;font-weight:500;
  box-shadow:0 8px 30px rgba(0,0,0,0.3);
  z-index:9999;
  animation:toastIn 0.4s var(--ease) both;
  pointer-events:none;
  white-space:nowrap;
}

/* NAV */
.nav{
  position:fixed;top:0;left:0;right:0;
  height:68px;
  display:flex;align-items:center;
  padding:0 22px;
  gap:14px;
  z-index:500;
  background:linear-gradient(180deg, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0.58) 100%);
  border-bottom:1px solid rgba(255,255,255,0.65);
  box-shadow:0 10px 30px rgba(17,24,39,0.09), inset 0 1px 0 rgba(255,255,255,0.95);
  backdrop-filter:blur(24px) saturate(165%);
  -webkit-backdrop-filter:blur(24px) saturate(165%);
}
.nav-logo{
  font-family:'Playfair Display',serif;
  font-size:22px;font-weight:700;
  color:var(--white);
  white-space:nowrap;
  letter-spacing:-0.5px;
  cursor:pointer;
}
.nav-logo span{color:var(--yellow);}
.nav-loc{
  display:flex;align-items:center;gap:6px;
  color:var(--gray-mid);font-size:13px;
  white-space:nowrap;
}
.nav-search{
  flex:1;max-width:360px;
  background:rgba(255,255,255,0.46);
  border:1px solid rgba(255,255,255,0.72);
  border-radius:999px;
  padding:8px 16px 8px 38px;
  color:var(--white);font-size:13px;
  transition:all .45s var(--ease);
  position:relative;
  backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px);
}
.nav-search:focus{
  background:rgba(255,255,255,0.7);
  border-color:rgba(255,255,255,0.9);
  box-shadow:0 0 0 3px rgba(255,255,255,0.45), 0 8px 24px rgba(17,24,39,0.08);
}
.nav-search::placeholder{color:var(--gray-mid);}
.nav-search-wrap{position:relative;flex:1;max-width:360px;}
.nav-search-icon{
  position:absolute;left:12px;top:50%;transform:translateY(-50%);
  color:var(--gray-mid);pointer-events:none;
}
.nav-tabs{display:flex;gap:2px;margin-left:auto;}
.nav-tab{
  padding:7px 16px;
  border-radius:999px;
  font-size:13px;font-weight:500;
  color:var(--gray-mid);
  cursor:pointer;
  transition:all .35s var(--ease);
  border:1px solid rgba(255,255,255,0);
}
.nav-tab:hover{
  color:var(--white);
  background:rgba(255,255,255,0.5);
  border-color:rgba(255,255,255,0.76);
}
.nav-tab.active{
  background:rgba(255,255,255,0.74);
  color:var(--white);
  font-weight:700;
  border-color:rgba(255,255,255,0.9);
  box-shadow:0 8px 18px rgba(17,24,39,0.08);
}
.nav-right{display:flex;align-items:center;gap:12px;flex-shrink:0;}
.nav-btn{
  padding:7px 18px;
  border-radius:999px;
  font-size:13px;font-weight:600;
  cursor:pointer;
  transition:all .35s var(--ease);
  border:1px solid rgba(255,255,255,0.76);
  background:rgba(255,255,255,0.46);
  color:var(--white);
  backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px);
}
.nav-btn:hover{
  background:rgba(255,255,255,0.68);
  border-color:rgba(255,255,255,0.92);
}
.nav-btn.primary{
  background:linear-gradient(180deg,#ffffff 0%,#f7f9fc 100%);
  color:#1f2937;
  border-color:rgba(255,255,255,0.95);
  box-shadow:0 8px 22px rgba(17,24,39,0.1);
}
.nav-btn.primary:hover{
  background:#ffffff;
  box-shadow:0 10px 24px rgba(17,24,39,0.14);
}
.nav-user{
  display:flex;align-items:center;gap:10px;
  cursor:pointer;
  padding:5px 14px 5px 5px;
  border-radius:999px;
  border:1px solid rgba(255,255,255,0.74);
  background:rgba(255,255,255,0.48);
  transition:all .35s var(--ease);
  backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px);
}
.nav-user:hover{
  background:rgba(255,255,255,0.7);
  border-color:rgba(255,255,255,0.92);
}
.nav-avatar{
  width:32px;height:32px;border-radius:50%;
  background:linear-gradient(145deg,#ffffff,#eef2f8);
  display:flex;align-items:center;justify-content:center;
  font-size:13px;font-weight:700;color:#334155;
  border:1.5px solid rgba(255,255,255,0.95);
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.95), 0 4px 10px rgba(17,24,39,0.08);
}

/* PAGE WRAPPER */
.page{
  min-height:100vh;
  padding-top:64px;
}

/* HERO BG */
.hero-bg{
  position:absolute;inset:0;
  overflow:hidden;pointer-events:none;
}
.blob{
  position:absolute;
  border-radius:50%;
  filter:blur(80px);
  animation:liquidBlob 8s ease-in-out infinite;
}

/* SECTION */
.section{padding:72px 48px;}
.section-title{
  font-family:'Playfair Display',serif;
  font-size:clamp(28px,4vw,42px);
  font-weight:700;
  line-height:1.15;
}
.section-sub{
  font-size:16px;
  color:var(--gray-mid);
  margin-top:10px;
  line-height:1.6;
}

/* CARD HOVER */
.card-hover{
  transition:transform .5s var(--ease),box-shadow .5s var(--ease);
  cursor:pointer;
}
.card-hover:hover{
  transform:translateY(-10px) scale(1.015);
  box-shadow:0 26px 52px rgba(17,24,39,0.14);
}

/* BTN */
.btn{
  display:inline-flex;align-items:center;justify-content:center;gap:8px;
  padding:13px 28px;
  border-radius:999px;
  font-size:15px;font-weight:600;
  cursor:pointer;
  transition:all .45s var(--ease);
  border:none;
  letter-spacing:0.1px;
}
.btn-yellow{
  background:linear-gradient(180deg,#d4b367 0%, #b7923f 100%);
  color:#ffffff;
}
.btn-yellow:hover{
  background:linear-gradient(180deg,#ddbb6f 0%, #c19d47 100%);
  transform:translateY(-3px);
  box-shadow:0 12px 32px rgba(183,146,63,0.28);
}
.btn-glass{
  background:#fff;
  border:1px solid var(--gray-line);
  color:var(--white);
  backdrop-filter:none;
  -webkit-backdrop-filter:none;
}
.btn-glass:hover{
  background:var(--gray-bg);
  transform:translateY(-2px);
}
.btn-outline{
  background:transparent;
  border:1.5px solid rgba(255,255,255,0.78);
  color:var(--white);
}
.btn-outline:hover{
  background:rgba(255,255,255,0.5);
  border-color:rgba(255,255,255,0.92);
}

/* FORM INPUTS */
.form-input{
  width:100%;
  padding:13px 18px;
  border-radius:var(--r-sm);
  background:rgba(255,255,255,0.72);
  border:1px solid rgba(255,255,255,0.82);
  color:var(--white);
  font-size:14px;
  transition:all .2s;
  backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px);
}
.form-input:focus{
  background:rgba(255,255,255,0.88);
  border-color:rgba(255,255,255,0.95);
  box-shadow:0 0 0 3px rgba(255,255,255,0.55), 0 10px 22px rgba(17,24,39,0.08);
}
.form-input::placeholder{color:var(--gray-mid);}
.form-label{
  font-size:12px;font-weight:600;
  color:var(--gray-mid);
  text-transform:uppercase;letter-spacing:.6px;
  margin-bottom:6px;display:block;
}

/* CHIP */
.chip{
  display:inline-flex;align-items:center;gap:6px;
  padding:8px 18px;
  border-radius:999px;
  font-size:13px;font-weight:500;
  cursor:pointer;
  transition:all .45s var(--ease);
  border:1px solid var(--gray-line);
  background:#fff;
  color:var(--gray-mid);
}
.chip:hover{border-color:var(--gray-mid);color:var(--white);}
.chip.active{
  background:var(--yellow);
  color:var(--black);
  border-color:transparent;
  font-weight:700;
}

/* STAR */
.stars{display:flex;align-items:center;gap:2px;}
.star{color:#FFB800;font-size:13px;}
.star.empty{color:#c7ced8;}

/* BADGE */
.badge{
  display:inline-flex;align-items:center;
  padding:3px 10px;border-radius:999px;
  font-size:11px;font-weight:600;
  text-transform:uppercase;letter-spacing:.4px;
}
.badge-green{background:var(--green-dim);color:var(--green);}
.badge-red{background:var(--red-dim);color:var(--red);}
.badge-yellow{background:var(--yellow-dim);color:var(--yellow2);}

/* DIVIDER */
.divider{
  display:flex;align-items:center;gap:16px;
  color:var(--gray-text);font-size:13px;
  margin:20px 0;
}
.divider::before,.divider::after{
  content:'';flex:1;
  height:1px;background:rgba(255,255,255,0.1);
}

/* SOCIAL BTN */
.social-btn{
  width:100%;
  padding:12px;
  border-radius:var(--r-sm);
  background:rgba(255,255,255,0.06);
  border:1px solid rgba(255,255,255,0.1);
  color:var(--white);
  font-size:14px;font-weight:500;
  display:flex;align-items:center;justify-content:center;gap:10px;
  transition:all .45s var(--ease);
}
.social-btn:hover{background:var(--gray-bg);border-color:var(--gray-line);}

/* CALENDAR */
.cal-wrap{border-radius:var(--r);overflow:hidden;}
.cal-nav{
  display:flex;align-items:center;justify-content:space-between;
  padding:16px 20px 12px;
}
.cal-month-label{font-size:15px;font-weight:700;}
.cal-arrow{
  width:32px;height:32px;border-radius:50%;
  background:rgba(255,255,255,0.07);
  border:1px solid rgba(255,255,255,0.12);
  color:var(--white);font-size:16px;
  display:flex;align-items:center;justify-content:center;
  transition:all .45s var(--ease);
}
.cal-arrow:hover:not(:disabled){background:var(--yellow);color:var(--black);border-color:transparent;}
.cal-arrow:disabled{opacity:.25;cursor:not-allowed;}
.cal-grid{
  display:grid;grid-template-columns:repeat(7,1fr);
  gap:3px;padding:0 16px 16px;
}
.cal-hdr{
  text-align:center;
  font-size:10px;font-weight:700;
  color:var(--gray-text);
  text-transform:uppercase;letter-spacing:.5px;
  padding-bottom:8px;
}
.cal-day{
  aspect-ratio:1;
  display:flex;flex-direction:column;
  align-items:center;justify-content:center;
  border-radius:10px;
  font-size:13px;font-weight:500;
  cursor:pointer;
  transition:all .45s var(--ease);
  position:relative;
  border:1.5px solid transparent;
}
.cal-day:not(.cal-empty):not(.cal-past):hover{
  background:rgba(255,255,255,0.08);
  border-color:rgba(255,255,255,0.12);
}
.cal-day.cal-today{color:var(--blue);font-weight:700;}
.cal-day.cal-today::after{
  content:'';position:absolute;bottom:4px;
  width:4px;height:4px;border-radius:50%;background:var(--blue);
}
.cal-day.cal-selected{
  background:var(--yellow)!important;
  color:var(--black)!important;
  border-color:transparent!important;
  font-weight:800!important;
}
.cal-day.cal-selected::after{display:none;}
.cal-day.cal-past{color:#b5bfcc;cursor:not-allowed;}
.cal-day.cal-has-slots::before{
  content:'';position:absolute;bottom:4px;
  width:4px;height:4px;border-radius:50%;background:var(--green);
}
.cal-day.cal-selected.cal-has-slots::before{background:var(--black);}
.cal-day.cal-empty{cursor:default;}

/* TIME SLOTS */
.time-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;}
.time-slot{
  padding:10px 6px;border-radius:10px;
  border:1px solid rgba(255,255,255,0.1);
  background:rgba(255,255,255,0.04);
  font-size:13px;font-weight:500;text-align:center;
  cursor:pointer;color:var(--white);
  transition:all .45s var(--ease);
}
.time-slot:hover:not(.unavail){
  background:rgba(255,255,255,0.1);
  border-color:rgba(255,255,255,0.2);
}
.time-slot.selected{
  background:var(--yellow);
  color:var(--black);
  border-color:transparent;
  font-weight:700;
}
.time-slot.unavail{
  opacity:.3;cursor:not-allowed;
  text-decoration:line-through;
}

.slot-btn{
  padding:10px 12px;border-radius:12px;
  border:1px solid rgba(255,255,255,0.12);
  background:rgba(255,255,255,0.06);
  font-size:13px;font-weight:600;text-align:center;
  color:var(--white);
  transition:all .2s var(--ease);
}
.slot-btn:hover:not(:disabled){
  border-color:var(--yellow);
  background:rgba(255,224,51,0.08);
}
.slot-btn-selected{
  border-color:var(--yellow)!important;
  background:var(--yellow-dim)!important;
  color:var(--white)!important;
}
.slot-btn-disabled{
  opacity:0.45;
  cursor:not-allowed;
  background:rgba(0,0,0,0.04);
}

/* PROVIDER LISTING CARD */
.provider-card{
  display:flex;align-items:flex-start;gap:16px;
  padding:34px;
  border-radius:var(--r);
  cursor:pointer;
  transition:all .5s var(--ease);
}
.provider-card:hover{
  background:rgba(255,255,255,0.65);
  transform:translateY(-8px) scale(1.01);
}
.provider-img{
  width:74px;height:74px;border-radius:20px;flex-shrink:0;
  display:flex;align-items:center;justify-content:center;
  font-size:22px;font-weight:700;
  background:rgba(255,255,255,0.65);
  border:1px solid rgba(255,255,255,0.88);
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.95), 0 8px 16px rgba(17,24,39,0.08);
}

/* FOOTER */
.footer{
  background:rgba(255,255,255,0.02);
  border-top:1px solid rgba(255,255,255,0.06);
  padding:48px;
  margin-top:auto;
}

/* BOOKING CONFIRM ANIMATION */
@keyframes checkPop{
  0%{transform:scale(0);opacity:0;}
  60%{transform:scale(1.2);}
  100%{transform:scale(1);opacity:1;}
}
.check-anim{animation:checkPop .5s var(--ease) both;}

/* MOBILE NAV */
@media(max-width:768px){
  .nav{padding:0 12px;gap:8px;height:62px;}
  .nav-loc{display:none;}
  .nav-search-wrap{max-width:none;}
  .nav-search{padding:7px 12px 7px 34px;font-size:12px;}
  .nav-right{gap:8px;}
  .nav-btn{padding:6px 12px;font-size:12px;}
  .nav-user span{display:none;}
  .page{padding-top:62px;}
  .nav-tabs{display:none;}
  .section{padding:48px 20px;}
}

@media(max-width:1024px){
  .nav-tabs{display:none;}
  .nav-loc{display:none;}
  .nav{padding:0 16px;}
}
`;
