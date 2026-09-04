module.exports = (req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.status(200).send(`User-agent: *
Allow: /

Sitemap: https://gameofpdf.com/sitemap.xml`);
};
