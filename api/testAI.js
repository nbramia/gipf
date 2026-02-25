// Simple test endpoint to verify CORS and basic functionality
export default async function handler(req, res) {
  try {
    console.log('Test endpoint called');
    console.log('Method:', req.method);
    console.log('Origin:', req.headers.origin);

    // CORS headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    const allowedOrigins = [
      'http://localhost:3000',
      'https://yinsh.vercel.app',
      'https://yinsh-nathan-ramias-projects.vercel.app'
    ];

    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      console.log('CORS header set for:', origin);
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
      console.log('Handling OPTIONS preflight');
      return res.status(200).end();
    }

    if (req.method === 'POST') {
      console.log('Handling POST request');

      // Return a dummy AI move response
      const response = {
        move: [0, 0],
        destination: [1, 1],
        type: 'move',
        confidence: 0.8,
        stats: {
          simulations: 0,
          timeMs: 10,
          complexity: 1,
          tableSize: 0
        },
        message: 'Test endpoint - CORS and basic functionality working!'
      };

      console.log('Returning test response');
      return res.status(200).json(response);
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Error in test endpoint:', error);
    return res.status(500).json({
      error: 'Test endpoint error',
      message: error.message
    });
  }
}
