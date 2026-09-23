export type Role = 'Donor' | 'Organizer' | 'Verifier';
export type Stage = 'planned' | 'pending' | 'approved' | 'rejected' | 'released';
export type Milestone = {id:string; title:string; amount:number; status:Stage; evidence:string; review:string};
export type Campaign = {id:string; title:string; location:string; category:'Medical aid'|'Clean water'|'Education'; description:string; raised:number; contributions:number; milestones:Milestone[]};
export type Entry = {id:string; campaignId:string; campaign:string; action:string; detail:string; amount:number; role:Role; time:string};
export type Ledger = {version:1; campaigns:Campaign[]; entries:Entry[]};
// Local record identifiers; getRandomValues also works in HTTP previews.
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
export type Action =
 | {type:'donate'; campaignId:string; amount:number}
 | {type:'submit'; campaignId:string; milestoneId:string; evidence:string}
 | {type:'review'; campaignId:string; milestoneId:string; approve:boolean; review:string}
 | {type:'release'; campaignId:string; milestoneId:string}
 | {type:'create'; title:string; location:string; category:Campaign['category']; description:string; milestones:{title:string;amount:number}[]};
export const goal = (c:Campaign) => c.milestones.reduce((sum,m)=>sum+m.amount,0);
export const released = (c:Campaign) => c.milestones.filter(m=>m.status==='released').reduce((sum,m)=>sum+m.amount,0);
export const balance = (c:Campaign) => c.raised-released(c);
export function cents(value:string):number {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) throw new Error('Enter a positive amount with at most two decimal places.');
  const amount=Math.round(Number(value)*100);
  if (!Number.isSafeInteger(amount) || amount<=0 || amount>100_000_000) throw new Error('Amount must be between 0.01 and 1,000,000 demo credits.');
  return amount;
}
const requireText=(s:string,min:number,max:number,label:string)=>{if(typeof s!=='string'||s.trim().length<min||s.trim().length>max)throw new Error(`${label} must contain ${min}–${max} characters.`);return s.trim();};
export function applyAction(state:Ledger, action:Action, role:Role):Ledger {
  const next:Ledger=structuredClone(state);
  if (state.entries.length>=1500) throw new Error('This local demo has reached its activity limit. Reset the demo to continue.');
  const event={id:newId(),time:new Date().toISOString(),role};
  if(action.type==='create'){
    if(role!=='Organizer')throw new Error('Switch to Organizer to create a campaign.');
    if(next.campaigns.length>=30)throw new Error('The demo supports up to 30 campaigns.');
    const title=requireText(action.title,4,80,'Campaign title');
    const location=requireText(action.location,2,80,'Location');
    const description=requireText(action.description,20,800,'Description');
    if(!['Medical aid','Clean water','Education'].includes(action.category))throw new Error('Choose a supported category.');
    if(action.milestones.length!==3)throw new Error('Add three milestones.');
    const milestones=action.milestones.map(m=>{
      const title=requireText(m.title,3,100,'Milestone title');
      if(!Number.isSafeInteger(m.amount)||m.amount<=0||m.amount>100_000_000)throw new Error('Each milestone needs a valid positive budget.');
      return {id:newId(),title,amount:m.amount,status:'planned' as Stage,evidence:'',review:''};
    });
    const c:Campaign={id:newId(),title,location,category:action.category,description,raised:0,contributions:0,milestones};
    next.campaigns.unshift(c);
    next.entries.unshift({...event,campaignId:c.id,campaign:c.title,action:'Campaign created',detail:'Three milestone budgets established.',amount:0});
    return next;
  }
  const c=next.campaigns.find(c=>c.id===action.campaignId);
  if(!c)throw new Error('Campaign not found.');
  let actionName='',detail='',amount=0;
  if(action.type==='donate'){
    if(role!=='Donor')throw new Error('Switch to Donor to add demo funds.');
    if(!Number.isSafeInteger(action.amount)||action.amount<=0)throw new Error('Enter a positive amount.');
    if(c.raised+action.amount>goal(c))throw new Error('This amount exceeds the remaining campaign goal.');
    c.raised+=action.amount;c.contributions++;amount=action.amount;actionName='Demo funds added';detail='Added to the campaign’s simulated balance.';
  }else{
    const index=c.milestones.findIndex(m=>m.id===action.milestoneId),m=c.milestones[index];
    if(!m)throw new Error('Milestone not found.');
    if(c.milestones.slice(0,index).some(m=>m.status!=='released'))throw new Error('Complete and release earlier milestones first.');
    if(action.type==='submit'){
      if(role!=='Organizer')throw new Error('Switch to Organizer to submit evidence.');
      if(!['planned','rejected'].includes(m.status))throw new Error('Evidence cannot be changed at this stage.');
      m.evidence=requireText(action.evidence,20,1500,'Evidence');m.review='';m.status='pending';actionName='Evidence submitted';detail=m.title+': '+m.evidence;
    }else if(action.type==='review'){
      if(role!=='Verifier')throw new Error('Switch to Verifier to review evidence.');
      if(m.status!=='pending')throw new Error('Only pending evidence can be reviewed.');
      m.review=requireText(action.review,10,600,'Review note');m.status=action.approve?'approved':'rejected';actionName=action.approve?'Milestone approved':'Changes requested';detail=m.title+': '+m.review;
    }else{
      if(role!=='Organizer')throw new Error('Switch to Organizer to release funds.');
      if(m.status!=='approved')throw new Error('A milestone must be approved before release.');
      if(balance(c)<m.amount)throw new Error('The campaign needs more demo funds before this milestone can be released.');
      m.status='released';amount=m.amount;actionName='Demo funds released';detail=m.title;
    }
  }
  next.entries.unshift({...event,campaignId:c.id,campaign:c.title,action:actionName,detail,amount});
  return next;
}

export function seedLedger():Ledger {
  const milestone=(id:string,title:string,amount:number,status:Stage='planned',evidence='',review=''):Milestone=>({id,title,amount,status,evidence,review});
  const campaigns:Campaign[]=[
    {id:'benin',title:'Medical Aid · Benin City',location:'Benin City, Nigeria',category:'Medical aid',description:'A fictional community care campaign providing essential supplies and follow-up support. Each budget is released only after the previous milestone is documented and reviewed. No real patients or medical records are involved.',raised:820000,contributions:24,milestones:[milestone('b1','Essential supplies',300000,'released','Demo receipt: 30 supply kits received and counted by the community team.','Demo review: item quantities match the budget.'),milestone('b2','Community care sessions',300000,'pending','Fictional activity report: three community sessions completed. The demo attendance summary and itemized spending record have been checked by the organizer.'),milestone('b3','Follow-up support',400000)]},
    {id:'water',title:'Clean Water for Uselu',location:'Uselu, Edo State',category:'Clean water',description:'A fictional project to restore a community water point. Funding is divided between assessment, installation, and a final water-quality check.',raised:450000,contributions:16,milestones:[milestone('w1','Site assessment',150000,'approved','Demo assessment: the fictional water point requires a new pump and pipe repair.','Demo review: the assessment and cost breakdown are consistent.'),milestone('w2','Pump installation',350000),milestone('w3','Quality check & handover',100000)]},
    {id:'school',title:'Learning Kits for Every Child',location:'Egor, Edo State',category:'Education',description:'A fictional education campaign assembling classroom learning kits. Organizers document purchases, distribution, and the final classroom handover.',raised:180000,contributions:9,milestones:[milestone('s1','Purchase learning materials',200000),milestone('s2','Assemble & distribute kits',150000),milestone('s3','Classroom handover',50000)]},
  ];
  const entries:Entry[]=[
    {id:'sample-b-review',campaignId:'benin',campaign:campaigns[0].title,action:'Evidence submitted',detail:'Community care sessions: '+campaigns[0].milestones[1].evidence,amount:0,role:'Organizer',time:'2026-09-20T15:40:00.000Z'},
    {id:'sample-w-approved',campaignId:'water',campaign:campaigns[1].title,action:'Milestone approved',detail:'Site assessment: '+campaigns[1].milestones[0].review,amount:0,role:'Verifier',time:'2026-09-20T14:30:00.000Z'},
    {id:'sample-w-submit',campaignId:'water',campaign:campaigns[1].title,action:'Evidence submitted',detail:'Site assessment: '+campaigns[1].milestones[0].evidence,amount:0,role:'Organizer',time:'2026-09-20T12:30:00.000Z'},
    {id:'sample-b-release',campaignId:'benin',campaign:campaigns[0].title,action:'Demo funds released',detail:'Essential supplies',amount:300000,role:'Organizer',time:'2026-09-19T15:00:00.000Z'},
    {id:'sample-b-approved',campaignId:'benin',campaign:campaigns[0].title,action:'Milestone approved',detail:'Essential supplies: '+campaigns[0].milestones[0].review,amount:0,role:'Verifier',time:'2026-09-19T14:00:00.000Z'},
    {id:'sample-b-submit',campaignId:'benin',campaign:campaigns[0].title,action:'Evidence submitted',detail:'Essential supplies: '+campaigns[0].milestones[0].evidence,amount:0,role:'Organizer',time:'2026-09-19T13:00:00.000Z'},
    ...campaigns.map((c,i)=>({id:'sample-fund-'+i,campaignId:c.id,campaign:c.title,action:'Sample opening balance',detail:`Fictional total of ${c.contributions} contributions.`,amount:c.raised,role:'Donor' as Role,time:'2026-09-18T10:00:00.000Z'}))
  ];
  return {version:1,campaigns,entries};
}
