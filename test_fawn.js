fetch('https://attendance-management-system-fm5z-fawn.vercel.app')
  .then(r => r.text())
  .then(html => {
    const match = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
    if (match) {
      const url = 'https://attendance-management-system-fm5z-fawn.vercel.app' + match[1];
      console.log('Fetching JS:', url);
      return fetch(url).then(r => r.text()).then(js => {
        console.log('Contains localhost:3001 ?', js.includes('localhost:3001'));
        console.log('Contains onrender.com ?', js.includes('attendance-management-system-ixze.onrender.com'));
      });
    } else {
      console.log('No JS found');
      console.log(html.substring(0, 500));
    }
  });
