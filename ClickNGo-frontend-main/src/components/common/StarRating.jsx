export default function StarRating({rating,count}){
  return (
    <div style={{display:"flex",alignItems:"center",gap:4}}>
      <div className="stars">
        {[1,2,3,4,5].map(s=>(
          <span key={s} className={`star${s>Math.round(rating)?" empty":""}`}>★</span>
        ))}
      </div>
      <span style={{fontSize:13,fontWeight:700}}>{rating}</span>
      {count&&<span style={{fontSize:12,color:"var(--gray-text)"}}>({count})</span>}
    </div>
  );
}
