fetch('https://attendance-management-system-fm5z-b1aevfvvv.vercel.app')
  .then(r => r.text())
  .then(html => {
    console.log(html.substring(0, 1000));
  });
