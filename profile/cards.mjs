import { offset, owner, projects, role } from './data.mjs';

const calendarInk = ['#dad0b9','#c4a18f','#a56e63','#85474a','#562b36'];
const languageInk = ['#5f313c','#a26149','#606c55','#948153','#697f83','#b7a990'];
const weekdays = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const socialLinks = [
  { id:'linkedin', label:'LinkedIn', alt:'Hector Rodriguez on LinkedIn', href:'https://www.linkedin.com/in/hmrguez', width:'33%' },
  { id:'email', label:'Email', alt:'Email Hector Rodriguez at zealot.algo@gmail.com', href:'mailto:zealot.algo@gmail.com', width:'34%' },
  { id:'x', label:'X', alt:'MachineZealot on X', href:'https://x.com/MachineZealot', width:'33%' },
];
const formatDate = new Intl.DateTimeFormat('en-GB', { day:'numeric', month:'short', year:'numeric', timeZone:'UTC' });
const formatMonth = new Intl.DateTimeFormat('en-US', { month:'short', timeZone:'UTC' });

export function escapeHtml(value) {
  return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
}

function calendar(weeks) {
  const wide = weeks.length > 30;
  const cell = wide ? 12.7 : 12;
  const left = wide ? 26 : 23;
  const months = weeks.map(week => formatMonth.format(new Date(offset(week[0].date, 3))));
  const parts = [];
  for (const [i, week] of weeks.entries()) {
    const month = months[i];
    const fits = i < weeks.length - 1 && (i > 0 || month === months[1]);
    if (month !== months[i-1] && fits) parts.push(`<text x="${left+i*cell}" y="10">${month}</text>`);
    for (const { date, contributionCount } of week) {
      const day = new Date(date).getUTCDay();
      const ink = calendarInk[[1,4,10,25].filter(min => contributionCount >= min).length];
      parts.push(`<rect x="${(left+i*cell).toFixed(2)}" y="${(16+day*cell).toFixed(2)}"
        width="${(cell-2).toFixed(2)}" height="${(cell-2).toFixed(2)}" fill="${ink}"/>`);
    }
  }
  for (const [day, label] of [[1,'M'],[3,'W'],[5,'F']]) {
    parts.push(`<text x="1" y="${16+(day+.78)*cell}">${label}</text>`);
  }
  return `<svg class="map" viewBox="0 0 ${left+cell*weeks.length} ${17+7*cell}">
    ${parts.join('')}<style>text{font:10px Arial,sans-serif;fill:#594a3e}</style></svg>`;
}

export function cards(data) {
  const { start, end, total, active, longest, weeks, languages } = data;
  const count = total.toLocaleString('en-US');
  const range = [start,end].map(d => formatDate.format(new Date(d))).join(' – ');
  const legend = calendarInk.map(color => `<i style="background:${color}"></i>`).join('');
  const heat = mobile => `<div class="top"><h2>${count} <i>contributions</i></h2><span class="label">${range}</span></div>
    ${mobile ? calendar(weeks.slice(0,26))+calendar(weeks.slice(26)) : calendar(weeks)}
    <div class="foot"><span class="small"><b>${active}</b> active days &nbsp;·&nbsp; Longest streak <b>${longest} days</b></span>
    <div class="legend"><span>0</span>${legend}<span>25+</span></div></div>`;
  const bars = languages.map(({size}, i) => `<i style="flex:${size};background:${languageInk[i]}"></i>`).join('');
  const key = languages.map(({name,percent}, i) => `<div><i style="background:${languageInk[i]}"></i>
    <span>${escapeHtml(name)}</span><b>${percent}%</b></div>`).join('');
  const peak = Math.max(...data.weekdays);
  const columns = data.weekdays.map((n,i) => `<div class="col ${n===peak && peak ? 'peak' : ''}">
    <span class="value">${n}</span><i style="height:${(n/Math.max(1,peak)*67).toFixed(1)}px"></i>
    <span class="day">${weekdays[i].slice(0,3)}</span></div>`).join('');
  const rows = projects.map(({name,path}) => `<div class="row"><strong>${name}</strong><code>${owner}/${path}</code></div>`).join('');
  return [
    { id:'masthead', className:'mast', width:'100%', mobile:true,
      alt:`Hector Rodriguez · ${role} · @${owner}`,
      html:() => `<img class="owl" src="art/owl.png"><img class="name" src="art/name.svg" alt="Hector Rodriguez">
        <div class="id"><em>${role}</em><span class="label">@${owner}</span></div>` },
    { id:'contributions', className:'heat', width:'100%', mobile:true, html:heat,
      alt:`${count} GitHub contributions, ${range}. ${active} active days. Longest streak ${longest} days.` },
    { id:'languages', className:'half', width:'50%', mobile:true, mobileWidth:'100%', gutter:'right',
      alt:'Share of code bytes across the five projects: '+languages.map(l=>`${l.name} ${l.percent}%`).join(', ')+'.',
      html:() => `<h2>Languages</h2><p class="scope">Code bytes across the five projects</p>
        <div class="swatches">${bars}</div><div class="key">${key || 'No language data'}</div>` },
    { id:'weekday', className:'half rhythm', width:'50%', mobile:true, mobileWidth:'100%', gutter:'left',
      alt:'Contributions by weekday: '+weekdays.map((d,i)=>d+' '+data.weekdays[i]).join(', ')+'.',
      html:() => `<h2>Contributions by weekday</h2><div class="hist">${columns}</div>` },
    { id:'projects', className:'projects', width:'100%', mobile:true,
      alt:'Projects: '+projects.map(p=>p.name+' ('+owner+'/'+p.path+')').join(', ')+'. Open repository list.',
      html:() => `<div class="proj-title"><img src="art/projects.svg" alt="Projects"></div><div class="rows">${rows}</div>` },
    ...socialLinks.map(({id,label,alt,width}) => ({
      id, alt, width, mobile:true, className:'contact contact-'+id,
      html:() => `<span>${label}</span><svg viewBox="0 0 16 16" aria-hidden="true">${id === 'email'
        ? '<path d="M1.5 3.5h13v9h-13z M2 4l6 4.5L14 4"/>'
        : '<path d="M3 13 13 3 M5 3h8v8"/>'}</svg>`,
    })),
  ];
}

export function readme(components) {
  const pictures = Object.fromEntries(components.map(({id,width,mobile,mobileWidth,alt}) => {
    const source = mobile ? `<source media="(max-width: 767px)" width="${mobileWidth ?? width}" srcset="assets/${id}-mobile.png">` : '';
    return [id, `<picture>${source}<img width="${width}" src="assets/${id}.png" alt="${escapeHtml(alt)}"></picture>`];
  }));
  const socials = socialLinks.map(({id,href}) => `<a href="${href}">${pictures[id]}</a>`).join('');
  // Adjacent inline images share a full line without a whitespace glyph between them.
  const rows = [pictures.masthead, pictures.contributions, pictures.languages+pictures.weekday,
    `<a href="https://github.com/${owner}?tab=repositories">${pictures.projects}</a>`,
    socials];
  return `<p>\n${rows.join('<br>\n')}\n</p>\n`;
}
