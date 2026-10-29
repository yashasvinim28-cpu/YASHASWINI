export default function ReviewCard({r,i,compact}){
  return (
    <div className={`glass-card animate-fade-up`} style={{padding:compact?16:22,animationDelay:`${i*.1}s`}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:compact?8:12}}>
        <div style={{
          width:compact?34:40,height:compact?34:40,borderRadius:"50%",
          background:"linear-gradient(135deg,#2a2a4a,#3a3a6a)",
          border:"1.5px solid rgba(255,224,51,0.2)",
          display:"flex",alignItems:"center",justifyContent:"center",
          fontSize:13,fontWeight:700,color:"var(--yellow)",flexShrink:0
        }}>{r.avatar}</div>
        <div style={{flex:1}}>
          <div style={{fontSize:13,fontWeight:700}}>{r.name}</div>
          <div style={{fontSize:11,color:"var(--gray-text)"}}>{r.date}</div>
        </div>
        <div className="stars">
          {[1,2,3,4,5].map(s=><span key={s} className={`star${s>r.rating?" empty":""}`} style={{fontSize:12}}>★</span>)}
        </div>
      </div>
      <p style={{fontSize:13,color:"rgba(255,255,255,0.65)",lineHeight:1.65}}>{r.text}</p>
    </div>
  );
}
