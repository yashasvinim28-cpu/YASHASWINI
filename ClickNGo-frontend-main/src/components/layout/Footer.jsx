import { Link } from "react-router-dom";

const CATEGORY_MAP = { Grooming: "grooming", "Real Estate": "realestate", HealthCare: "healthcare", "Sports & Gaming": "sports" };

export default function Footer() {
  return (
    <footer style={{
      borderTop:"1px solid rgba(255,255,255,0.06)",
      padding:"48px 48px 32px",
      background:"rgba(255,255,255,0.01)"
    }}>
      <div style={{maxWidth:1100,margin:"0 auto",display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr",gap:32,marginBottom:40}}>
        <div>
          <Link to="/" style={{textDecoration:"none"}}>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:700,marginBottom:10,color:"inherit"}}>
              Click<span style={{color:"var(--yellow)"}}>n</span>Go
            </div>
          </Link>
          <p style={{fontSize:13,color:"var(--gray-text)",lineHeight:1.7,maxWidth:260}}>
            The easiest way to discover and book trusted local services. All in a few taps.
          </p>
        </div>
        {[
          {title:"Services",links:["Grooming","Real Estate","HealthCare","Sports & Gaming"], isCategory: true},
          {title:"Company",links:["About Us","Careers","Press","Blog"]},
          {title:"Support",links:["Help Center","Privacy Policy","Terms","Contact"]},
        ].map(col=>(
          <div key={col.title}>
            <div style={{fontSize:12,fontWeight:700,color:"var(--gray-mid)",textTransform:"uppercase",letterSpacing:".5px",marginBottom:14}}>{col.title}</div>
            <div style={{display:"flex",flexDirection:"column",gap:9}}>
              {col.links.map(l=>(
                col.isCategory && CATEGORY_MAP[l] ? (
                  <Link key={l} to={`/category/${CATEGORY_MAP[l]}`} style={{fontSize:13,color:"var(--gray-text)",cursor:"pointer",transition:"color .2s",textDecoration:"none"}}
                    onMouseEnter={e=>e.target.style.color="var(--white)"} onMouseLeave={e=>e.target.style.color="var(--gray-text)"}
                  >{l}</Link>
                ) : (
                  <span key={l} style={{fontSize:13,color:"var(--gray-text)",cursor:"pointer",transition:"color .2s"}}
                    onMouseEnter={e=>e.target.style.color="var(--white)"} onMouseLeave={e=>e.target.style.color=""}
                  >{l}</span>
                )
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{borderTop:"1px solid rgba(255,255,255,0.05)",paddingTop:20,display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12,color:"var(--gray-text)"}}>
        <span>© 2025 ClicknGo. All rights reserved.</span>
        <span>Built for local communities</span>
      </div>
    </footer>
  );
}
