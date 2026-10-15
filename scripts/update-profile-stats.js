'use strict';

// Profile stats: update a committed SVG instead of embedding live third-party images.
// Uses the repository GITHUB_TOKEN for public data. PROFILE_STATS_TOKEN is optional,
// and only extends read access to private repositories if explicitly configured.
const fs = require('node:fs');
const username = 'pablohgs05';
const publicToken = process.env.GITHUB_TOKEN;
const privateToken = process.env.PROFILE_STATS_TOKEN;
const apiHost = 'https://api.github.com';

const langExtensions = {
  py:'Python',java:'Java',ts:'TypeScript',tsx:'TypeScript',dart:'Dart',
  vue:'Vue',js:'JavaScript',jsx:'JavaScript',sql:'SQL',html:'HTML',
  htm:'HTML',css:'CSS',scss:'CSS',kt:'Kotlin',cs:'C#',cpp:'C++',
  c:'C',go:'Go',rs:'Rust',swift:'Swift',php:'PHP',rb:'Ruby',
  sh:'Shell',ps1:'PowerShell'
};
const palette = ['#f89820','#3776ab','#3178c6','#13b8e9','#42b883','#8c91aa'];
const languageColors = {Java:'#f89820',Python:'#3776ab',TypeScript:'#3178c6',Dart:'#13b8e9',Vue:'#42b883',JavaScript:'#f7df1e',Other:'#8c91aa'};
const exclusions = /(^|\/)(node_modules|vendor|dist|build|coverage|target|\.venv|venv|__pycache__|\.next|\.dart_tool|generated|\.git|out)\//i;
const generated = /(\.min\.(js|css)|\.g\.(dart|ts)|\.freezed\.dart|\.pb\.go|\.generated\.)/i;
const escapeXml = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const wait = ms => new Promise(resolve => setTimeout(resolve,ms));

async function request(path, method='GET', body, token=privateToken || publicToken) {
  if (!token) throw new Error('No GitHub API token is available');
  for (let attempt=1;attempt<=3;attempt++) {
    try {
      const response = await fetch(apiHost+path, {
        method,
        headers:{
          Authorization:'Bearer '+token,
          Accept:'application/vnd.github+json',
          'X-GitHub-Api-Version':'2022-11-28',
          'Content-Type':'application/json',
          'User-Agent':'profile-stats-pablohgs05'
        },
        body:body ? JSON.stringify(body) : undefined,
        signal:AbortSignal.timeout(20000)
      });
      if (response.ok) return await response.json();
      if (![429,500,502,503,504].includes(response.status) || attempt===3) {
        throw new Error('GitHub API returned HTTP '+response.status+' for '+path.split('?')[0]);
      }
    } catch(error) {
      if (attempt===3 || /GitHub API returned HTTP/.test(error.message)) throw error;
    }
    await wait(1200*attempt);
  }
  throw new Error('Unexpected API retry exhaustion');
}
async function pageList(path, limit=10, token=privateToken || publicToken) {
  const all=[];
  for(let page=1;page<=limit;page++) {
    const items=await request(path+(path.includes('?')?'&':'?')+'per_page=100&page='+page,'GET',undefined,token);
    if(!Array.isArray(items)) throw new Error('Invalid repository list response');
    all.push(...items);
    if(items.length<100) return all;
  }
  throw new Error('Repository pagination limit reached; refusing to publish incomplete totals');
}
function chooseContributions(views) {
  if(!Array.isArray(views)||!views.length) throw new Error('No contribution data available');
  const output={commits:0,prs:0,issues:0};
  for(const view of views) {
    for(const key of Object.keys(output)) {
      if(!Number.isSafeInteger(view[key])||view[key]<0) throw new Error('Invalid '+key+' contribution count');
      output[key]=Math.max(output[key],view[key]);
    }
  }
  return output;
}
async function yearlyContributions(year, token) {
  const now=new Date();
  const from=year+'-01-01T00:00:00Z';
  const end=new Date(Date.UTC(year,11,31,23,59,59));
  const to=(end>now?now:end).toISOString();
  const query='query($name:String!,$from:DateTime!,$to:DateTime!){ user(login:$name){ contributionsCollection(from:$from,to:$to){ totalCommitContributions totalPullRequestContributions totalIssueContributions } } }';
  const response=await request('/graphql','POST',{query,variables:{name:username,from,to}},token);
  if(response.errors?.length) throw new Error('GitHub contribution query failed: '+response.errors[0].message);
  const data=response.data?.user?.contributionsCollection;
  if(!data) throw new Error('GitHub returned no contribution collection');
  return {
    commits:data.totalCommitContributions,
    prs:data.totalPullRequestContributions,
    issues:data.totalIssueContributions
  };
}
async function contributions() {
  // GitHub App/repository tokens and fine-grained PATs may have different views
  // of GraphQL contributions. Never let a narrower view reduce a metric.
  // Taking the highest count PER YEAR and metric avoids double-counting overlap.
  if(!publicToken) throw new Error('GITHUB_TOKEN is required for baseline contributions');
  const total={commits:0,prs:0,issues:0};
  let privateViews=0;
  for(let year=2023;year<=new Date().getUTCFullYear();year++) {
    const views=[await yearlyContributions(year,publicToken)];
    if(privateToken&&privateToken!==publicToken) {
      try {
        views.push(await yearlyContributions(year,privateToken));
        privateViews++;
      } catch(error) {
        // The PAT may be limited to repository contents; the reliable baseline
        // remains the GitHub Actions token. Don't publish PAT error details.
        console.warn('Supplemental contribution view unavailable for '+year+'; retaining Actions-token baseline.');
      }
    }
    const selected=chooseContributions(views);
    for(const key of Object.keys(total)) total[key]+=selected[key];
  }
  console.log('Contribution totals verified with the Actions token and '+privateViews+' supplemental annual view(s).');
  return total;
}
async function ownedRepositories() {
  if(process.env.REQUIRE_PRIVATE_STATS==='true'&&!privateToken) {
    throw new Error('Required PROFILE_STATS_TOKEN is missing; last published image is preserved');
  }
  const byName=new Map();
  // The public list also works when the fine-grained token cannot see org/team repos.
  const publicRepos=await pageList('/users/'+username+'/repos?type=owner',10,publicToken);
  for(const repo of publicRepos) {
    if(repo.owner?.login?.toLowerCase()===username) byName.set(repo.full_name,repo);
  }
  if(privateToken) {
    // Fail visibly if the configured token has expired or lost repository access.
    // Never silently rewrite a private-inclusive image as public-only.
    const permitted=await pageList('/user/repos?affiliation=owner',10,privateToken);
    for(const repo of permitted) {
      if(repo.owner?.login?.toLowerCase()===username) byName.set(repo.full_name,repo);
    }
  }
  return [...byName.values()];
}
async function languages(repositories) {
  const totals={}; let measured=0; let inspected=0; let empty=0;
  // Archived repositories contain work too; include them, and never silently
  // omit source trees just because GitHub temporarily refuses a request.
  for(const repo of repositories) {
    if(!repo.default_branch) {empty++;continue;}
    const tree=await request('/repos/'+repo.full_name+'/git/trees/'+encodeURIComponent(repo.default_branch)+'?recursive=1');
    if(!Array.isArray(tree.tree)||tree.truncated) {
      throw new Error('Incomplete source tree from GitHub; preserving the previous image');
    }
    for(const file of tree.tree) {
      if(file.type!=='blob'||!file.size||file.size>1000000)continue;
      const path=file.path.toLowerCase();
      if(exclusions.test(path)||generated.test(path))continue;
      const ext=path.split('.').pop();
      const language=langExtensions[ext];
      if(!language)continue;
      totals[language]=(totals[language]||0)+file.size;
      measured+=file.size;
    }
    inspected++;
  }
  if(!measured||!inspected) throw new Error('No usable source-file data; preserving existing image');
  return {totals,measured,inspected,empty};
}
function render(stats, repos, usage) {
  const today=new Date().toISOString().slice(0,10);
  const ordered=Object.entries(usage.totals).sort((a,b)=>b[1]-a[1]);
  const top=ordered.slice(0,5);
  const other=ordered.slice(5).reduce((total,item)=>total+item[1],0);
  if(other>0)top.push(['Other',other]);
  const legend=top.map(([name,bytes],i)=>({
    name,pct:bytes/usage.measured*100,color:languageColors[name]||palette[i]
  }));
  const shown=legend.map(v=>v.name+' '+v.pct.toFixed(1)+'%').join(', ');
  const privateCount=repos.filter(repo=>repo.private).length;
  const ownership=privateCount?'incl. '+privateCount+' private':'public';
  const lines=[];
  lines.push('<svg xmlns="http://www.w3.org/2000/svg" width="880" height="305" viewBox="0 0 880 305" role="img" aria-labelledby="title desc">');
  lines.push('<title id="title">GitHub activity and repository languages, refreshed '+today+'</title>');
  lines.push('<desc id="desc">'+escapeXml('GitHub credited contributions since 2023: '+stats.commits+' commits, '+stats.prs+' pull requests. '+repos.length+' owned repositories visible to the updater ('+privateCount+' private). Source file distribution: '+shown+'. Not an authorship or proficiency measurement.')+'</desc>');
  lines.push('<rect x="1" y="1" width="878" height="303" rx="16" fill="#151b29" stroke="#303b50" stroke-width="2"/>');
  lines.push('<g font-family="Arial,Helvetica,sans-serif">');
  lines.push('<text x="30" y="36" fill="#f8fafc" font-size="21" font-weight="700">GitHub activity &amp; languages</text>');
  lines.push('<text x="850" y="35" text-anchor="end" fill="#aab7ca" font-size="13">Updated '+today+'</text>');
  const values=[
    [stats.commits,'Credited commits since 2023'],
    [stats.prs,'Pull requests since 2023'],
    [repos.length,'Owned repos ('+ownership+')']
  ];
  values.forEach((item,i)=>{
    const x=30+i*278;
    lines.push('<rect x="'+x+'" y="53" width="262" height="74" rx="8" fill="#202a3d"/>');
    lines.push('<text x="'+(x+16)+'" y="88" font-size="27" font-weight="700" fill="#fff">'+item[0].toLocaleString('en-US')+'</text>');
    lines.push('<text x="'+(x+16)+'" y="111" font-size="12.7" fill="#b9c7da">'+escapeXml(item[1])+'</text>');
  });
  lines.push('<text x="30" y="161" fill="#dce5f2" font-size="16" font-weight="700">Source-file language mix (incl. forks)</text>');
  let current=30;
  for(let i=0;i<legend.length;i++){
    const v=legend[i];
    const width=820*v.pct/100;
    lines.push('<rect x="'+current.toFixed(2)+'" y="171" width="'+width.toFixed(2)+'" height="20" fill="'+v.color+'"/>');
    current+=width;
  }
  legend.forEach((v,i)=>{
    const x=30+(i%3)*274,y=219+Math.floor(i/3)*31;
    lines.push('<circle cx="'+(x+7)+'" cy="'+(y-5)+'" r="6" fill="'+v.color+'"/>');
    lines.push('<text x="'+(x+20)+'" y="'+y+'" font-size="15" fill="#e5eaf2">'+escapeXml(v.name)+'</text>');
    lines.push('<text x="'+(x+240)+'" y="'+y+'" text-anchor="end" font-size="15" font-weight="700" fill="#fff">'+v.pct.toFixed(1)+'%</text>');
  });
  lines.push('<text x="30" y="288" font-size="11.5" fill="#94a3b8">GitHub-attributed contributions; languages include forks and describe repository files, not individual authorship.</text>');
  lines.push('</g></svg>');
  return lines.join('\n')+'\n';
}
if(require.main===module) (async()=>{
  const [stats,repos]=await Promise.all([contributions(),ownedRepositories()]);
  const usage=await languages(repos);
  fs.mkdirSync('assets',{recursive:true});
  const svg=render(stats,repos,usage);
  const existing=fs.existsSync('assets/profile-stats.svg')?fs.readFileSync('assets/profile-stats.svg','utf8'):'';
  if(existing!==svg) fs.writeFileSync('assets/profile-stats.svg',svg,'utf8');
  console.log('Profile visualization refreshed. '+repos.length+' owned repos ('+repos.filter(repo=>repo.private).length+' private); '+usage.inspected+' source trees inspected; '+usage.empty+' empty.');
})().catch(error=>{
  // Keep the last good SVG and FAIL the job so GitHub can report the incident.
  console.error('Profile stats refresh failed; preserving last-known-good image. '+error.message);
  process.exitCode=1;
});

module.exports={chooseContributions};
