import app from "./src/app.js";

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Log analyzer API listening on http://localhost:${port}`);
});
