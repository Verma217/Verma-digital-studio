// Final working code with:
// - Fixed session store using connect-sqlite3
// - Port binding for Render
// - Upload-one secure check
// - ✅ Added "/" (home) route to fix "Cannot GET /" issue on Render

import express from "express";
import session from "express-session";
import SQLiteStore from "connect-sqlite3";
import bcrypt from "bcrypt";
import multer from "multer";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import db, { seedPhotographer, getUserByEmail, createUser } from "./db.js";

seedPhotographer();

const app = express();
app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    store: new (SQLiteStore(session))({ db: "sessions.sqlite", dir: "./" }),
    secret: "wedding-secret",
    resave: false,
    saveUninitialized: false,
  })
);

app.use("/static", express.static("public"));
app.use("/projects", express.static("projects"));

// ✅ Fix for Render: Home route
app.get("/", (req, res) => {
  if (req.session.user) {
    res.redirect("/dashboard");
  } else {
    res.redirect("/login");
  }
});

function isAuth(req, res, next) {
  if (req.session.user) return next();
  res.redirect("/login");
}

const upload = multer({ storage: multer.memoryStorage() });

app.get("/signup", (req, res) => res.render("signup", { err: null }));

app.post("/signup", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.render("signup", { err: "All fields required" });

  const created = createUser(email, password);
  if (!created) return res.render("signup", { err: "Email already exists" });

  const user = getUserByEmail(email);
  req.session.user = { id: user.id, email: user.email };
  res.redirect("/dashboard");
});

app.get("/login", (req, res) => res.render("login", { err: null }));

app.post("/login", (req, res) => {
  const { email, password } = req.body;
  const user = getUserByEmail(email);
  if (user && bcrypt.compareSync(password, user.passwordHash)) {
    req.session.user = { id: user.id, email: user.email };
    return res.redirect("/dashboard");
  }
  res.render("login", { err: "Invalid credentials" });
});

app.get("/logout", (req, res) => req.session.destroy(() => res.redirect("/login")));

app.get("/dashboard", isAuth, (req, res) => {
  const userId = req.session.user.id;
  const projects = db.prepare("SELECT * FROM projects WHERE userId = ? ORDER BY rowid DESC").all(userId);

  const enriched = projects.map((p) => {
    const base = path.join("projects", p.id, "lowres");
    let photoCount = 0;
    let coverImage = null;

    if (fs.existsSync(base)) {
      const folders = fs.readdirSync(base).filter((f) => fs.statSync(path.join(base, f)).isDirectory());
      for (const folder of folders) {
        const imgs = fs.readdirSync(path.join(base, folder)).filter((f) => /\.(jpe?g|png)$/i.test(f));
        photoCount += imgs.length;
        if (!coverImage && imgs.length) {
          coverImage = `/projects/${p.id}/lowres/${folder}/${imgs[0]}`;
        }
      }
    }
    return { ...p, photoCount, coverImage };
  });

  res.render("welcome", { user: req.session.user, projects: enriched });
});

app.post("/create-project", isAuth, (req, res) => {
  const id = uuidv4();
  const userId = req.session.user.id;
  db.prepare("INSERT INTO projects(id, name, status, token, selected, userId) VALUES(?, ?, ?, ?, ?, ?)")
    .run(id, req.body.projectName.trim(), "New", null, JSON.stringify([]), userId);
  res.redirect(`/project/${id}`);
});

app.post("/project/:projectId/delete", isAuth, (req, res) => {
  const { projectId } = req.params;
  const project = db.prepare("SELECT * FROM projects WHERE id=?").get(projectId);
  if (!project || project.userId !== req.session.user.id) return res.status(403).send("Access denied");
  db.prepare("DELETE FROM projects WHERE id=?").run(projectId);
  const dir = path.join("projects", projectId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  res.redirect("/dashboard");
});

app.get("/project/:projectId", isAuth, (req, res) => {
  const project = db.prepare("SELECT * FROM projects WHERE id=?").get(req.params.projectId);
  if (!project || project.userId !== req.session.user.id) return res.status(403).send("Access denied");
  const grouped = {};
  const base = path.join("projects", project.id, "lowres");
  if (fs.existsSync(base)) {
    fs.readdirSync(base).filter(f => fs.statSync(path.join(base, f)).isDirectory())
      .forEach(folder => { grouped[folder] = fs.readdirSync(path.join(base, folder)); });
  }
  res.render("project", { projectId: project.id, project, grouped });
});

app.post("/project/:projectId/upload-one", isAuth, upload.array("photos", 500), async (req, res) => {
  const { projectId } = req.params;
  const folder = req.body.folder?.trim() || "misc";

  const project = db.prepare("SELECT * FROM projects WHERE id=?").get(projectId);
  if (!project || project.userId !== req.session.user.id) return res.status(403).send("Access denied");

  const base = path.join("projects", projectId, "lowres", folder);
  fs.mkdirSync(base, { recursive: true });

  try {
    for (const file of req.files) {
      await sharp(file.buffer)
        .resize({ width: 1200 })
        .jpeg({ quality: 70 })
        .toFile(path.join(base, file.originalname));
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

app.get("/project/:projectId/generate-link", isAuth, (req, res) => {
  const project = db.prepare("SELECT * FROM projects WHERE id=?").get(req.params.projectId);
  if (!project || project.userId !== req.session.user.id) return res.status(403).send("Access denied");
  const token = uuidv4();
  db.prepare("UPDATE projects SET status=?, token=? WHERE id=?")
    .run("Under Selection", token, req.params.projectId);
  const clientLink = `https://verma-digital-studio.onrender.com/select/${token}`;
  res.render("link-generated", { clientLink });
});

app.get("/select/:token", (req, res) => {
  const project = db.prepare("SELECT * FROM projects WHERE token=?").get(req.params.token);
  if (!project) return res.status(404).send("Invalid link");
  const grouped = {};
  const base = path.join("projects", project.id, "lowres");
  fs.readdirSync(base).filter(f => fs.statSync(path.join(base, f)).isDirectory())
    .forEach(folder => { grouped[folder] = fs.readdirSync(path.join(base, folder)); });
  res.render("client", { token: req.params.token, projectId: project.id, grouped });
});

app.post("/select/:token/submit", (req, res) => {
  const project = db.prepare("SELECT * FROM projects WHERE token=?").get(req.params.token);
  if (!project) return res.status(404).send("Invalid token");
  const selected = Array.isArray(req.body.selected) ? req.body.selected : [req.body.selected];
  db.prepare("UPDATE projects SET selected=?, status='Completed' WHERE id=?")
    .run(JSON.stringify(selected), project.id);
  res.render("thankyou");
});

app.get("/project/:projectId/download-bat", isAuth, (req, res) => {
  const project = db.prepare("SELECT * FROM projects WHERE id=?").get(req.params.projectId);
  if (!project || project.userId !== req.session.user.id) return res.status(403).send("Access denied");
  const selected = JSON.parse(project.selected || "[]");
  const lines = [
    `@echo off`,
    `echo Copying selected files...`,
    `mkdir SELECTED`
  ];
  selected.forEach(relPath => {
    const winPath = relPath.replace(/\//g, "\\");
    const dir = path.dirname(winPath);
    if (dir !== ".") {
      lines.push(`if not exist "SELECTED\\${dir}" mkdir "SELECTED\\${dir}"`);
    }
    lines.push(`if exist "%~dp0${winPath}" copy /y "%~dp0${winPath}" "SELECTED\\${winPath}"`);
  });
  lines.push(`echo Done!`);
  res.setHeader("Content-Disposition", `attachment; filename="${project.name.replace(/\s+/g, "_")}_selection.bat"`);
  res.type("bat").send(lines.join("\r\n"));
});

// 🔊 REQUIRED FOR RENDER: Bind to PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\u2705 Server running at http://localhost:${PORT}`);
});

export default app;
