const jwt = process.argv[2];

fetch('https://attendance-management-system-ixze.onrender.com/api/issue-qr-token', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + jwt,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ sessionId: "e067c2cd-5e16-43b6-bf25-2efc2a9ec2b1" }) // fake session
})
.then(res => res.json())
.then(console.log)
.catch(console.error);
