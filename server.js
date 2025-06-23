/*  server.js  —  Wedding Photo Selection
    folder‑wise upload + delete + cover‑thumbnail + contact + about + gallery + project‑edit helpers
*/
import express from "express";
import session from "express-session";
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
    secret: "wedding-secret",
    resave: false,
    saveUninitialized: false,
  })
);

/* ---------- static assets ---------- */
app.use("/static",  express.static("public"));
app.use("/projects", express.static("projects"));

/* ---------- helpers ---------- */
function isAuth(req, res, next) {
  if (req.session.user) return next();
  res.redirect("/login");
}
const upload = multer({ storage: multer.memoryStorage() });   // in‑memory upload

/* ─────────────  PUBLIC PAGES ───────────── */
// About
app.get("/about", (_req, res) => res.render("about"));

// Gallery – reads /public/gallery for demo images
app.get("/gallery", (_req, res) => {
  const folder = "public/gallery";
  const images = fs.existsSync(folder)
    ? fs.readdirSync(folder).filter(f => /\.(jpe?g|png)$/i.test(f))
    : [];
  res.render("gallery", { images });
});

// Contact
app.get("/contact", (_req, res) => res.render("contact", { message: null }));
app.post("/contact", (req, res) => {
  const { name, email, message } = req.body;
  console.log("Contact form ->", { name, email, message });
  // nodemailer integration यहाँ बाद में जोड़ सकते हैं
  res.render("contact", { message: "Thank you! We’ll get back to you soon." });
});

/* ─────────────  AUTH  ───────────── */
app.get("/signup",  (req,res)=>res.render("signup",{err:null}));
app.post("/signup", (req,res)=>{
  const {email,password} = req.body;
  if(!email || !password) return res.render("signup",{err:"All fields required"});
  if(!createUser(email,password)) return res.render("signup",{err:"Email already exists"});
  req.session.user = {email};
  res.redirect("/");
});

app.get("/login",  (req,res)=>res.render("login",{err:null}));
app.post("/login", (req,res)=>{
  const {email,password} = req.body;
  const user = getUserByEmail(email);
  if(user && bcrypt.compareSync(password,user.passwordHash)){
    req.session.user = {id:user.id,email:user.email};
    return res.redirect("/");
  }
  res.render("login",{err:"Invalid credentials"});
});
app.get("/logout", (req,res)=>req.session.destroy(()=>res.redirect("/login")));

/* ─────────────  DASHBOARD  ───────────── */
app.get("/", isAuth, (req,res)=>{
  const projects = db.prepare("SELECT * FROM projects ORDER BY rowid DESC").all();

  const enriched = projects.map(p=>{
    const base = path.join("projects",p.id,"lowres");
    let photoCount = 0;
    let coverImage = null;

    if(fs.existsSync(base)){
      const folders = fs.readdirSync(base).filter(f=>fs.statSync(path.join(base,f)).isDirectory());
      for(const folder of folders){
        const imgs = fs.readdirSync(path.join(base,folder)).filter(f=>/\.(jpe?g|png)$/i.test(f));
        photoCount += imgs.length;
        if(!coverImage && imgs.length){
          coverImage = `/projects/${p.id}/lowres/${folder}/${imgs[0]}`;
        }
      }
    }
    return {...p, photoCount, coverImage};
  });

  res.render("welcome",{user:req.session.user, projects:enriched});
});

/* ─────────────  PROJECT CRUD  ───────────── */
app.post("/create-project", isAuth, (req,res)=>{
  const id = uuidv4();
  db.prepare("INSERT INTO projects(id,name,status,token,selected) VALUES(?,?,?,?,?)")
    .run(id, req.body.projectName.trim(), "New", null, JSON.stringify([]));
  res.redirect(`/project/${id}`);
});

app.post("/project/:projectId/delete", isAuth, (req,res)=>{
  const {projectId} = req.params;
  db.prepare("DELETE FROM projects WHERE id=?").run(projectId);
  const dir = path.join("projects", projectId);
  if(fs.existsSync(dir)) fs.rmSync(dir,{recursive:true,force:true});
  res.redirect("/");
});

app.get("/project/:projectId", isAuth, (req,res)=>{
  const project = db.prepare("SELECT * FROM projects WHERE id=?").get(req.params.projectId);
  if(!project) return res.status(404).send("Project not found");
  const grouped = {};
  const base = path.join("projects",project.id,"lowres");
  if(fs.existsSync(base)){
    fs.readdirSync(base).filter(f=>fs.statSync(path.join(base,f)).isDirectory())
      .forEach(folder=>{ grouped[folder]=fs.readdirSync(path.join(base,folder)); });
  }
  res.render("project",{projectId:project.id, project, grouped});
});

/* ---- edit helpers ---- */
app.post("/project/:projectId/update-status", isAuth,(req,res)=>{
  db.prepare("UPDATE projects SET status=? WHERE id=?").run(req.body.status, req.params.projectId);
  res.redirect(`/project/${req.params.projectId}`);
});
app.post("/project/:projectId/delete-folder", isAuth,(req,res)=>{
  const dir = path.join("projects",req.params.projectId,"lowres",req.body.folder);
  if(fs.existsSync(dir)) fs.rmSync(dir,{recursive:true,force:true});
  res.redirect(`/project/${req.params.projectId}`);
});
app.post("/project/:projectId/delete-image", isAuth,(req,res)=>{
  const img = path.join("projects",req.params.projectId,"lowres",req.body.folder,req.body.image);
  if(fs.existsSync(img)) fs.unlinkSync(img);
  res.redirect(`/project/${req.params.projectId}`);
});

/* ---- upload ---- */
app.post("/project/:projectId/upload-one", isAuth, upload.array("photos",500), async (req,res)=>{
  const base = path.join("projects", req.params.projectId, "lowres", req.body.folder || "misc");
  fs.mkdirSync(base,{recursive:true});
  try{
    for(const file of req.files){
      await sharp(file.buffer).resize({width:1200}).jpeg({quality:70}).toFile(path.join(base,file.originalname));
    }
    res.json({success:true});
  }catch(err){
    console.error(err); res.status(500).json({success:false});
  }
});

/* ---- client link ---- */
app.get("/project/:projectId/generate-link", isAuth,(req,res)=>{
  const token = uuidv4();
  db.prepare("UPDATE projects SET status=?, token=? WHERE id=?").run("Under Selection",token,req.params.projectId);
  res.redirect(`/project/${req.params.projectId}`);
});

/* ─────────────  CLIENT SELECTION  ───────────── */
app.get("/select/:token", (req,res)=>{
  const project = db.prepare("SELECT * FROM projects WHERE token=?").get(req.params.token);
  if(!project) return res.status(404).send("Invalid link");

  const grouped = {};
  const base = path.join("projects",project.id,"lowres");
  fs.readdirSync(base).filter(f=>fs.statSync(path.join(base,f)).isDirectory())
    .forEach(folder=>{ grouped[folder] = fs.readdirSync(path.join(base,folder)); });

  res.render("client",{token:req.params.token, projectId:project.id, grouped});
});
app.post("/select/:token/submit",(req,res)=>{
  const project = db.prepare("SELECT * FROM projects WHERE token=?").get(req.params.token);
  if(!project) return res.status(404).send("Invalid token");
  const selected = Array.isArray(req.body.selected)?req.body.selected:[req.body.selected];
  db.prepare("UPDATE projects SET selected=?,status='Completed' WHERE id=?")
    .run(JSON.stringify(selected), project.id);
  res.render("thankyou");
});

/* ─────────────  .BAT download  ───────────── */
app.get("/project/:projectId/download-bat", isAuth,(req,res)=>{
  const project = db.prepare("SELECT * FROM projects WHERE id=?").get(req.params.projectId);
  if(!project) return res.status(404).send("Project not found");
  const selected = JSON.parse(project.selected||"[]");
  const lines = ["@echo off","mkdir SELECTED"];
  selected.forEach(f=>{
    const winPath = f.replace(/\//g,"\\");
    const dir = path.dirname(winPath);
    if(dir!=="." ) lines.push(`if not exist "SELECTED\\${dir}" mkdir "SELECTED\\${dir}"`);
    lines.push(`if exist "%~dp0${winPath}" copy /y "%~dp0${winPath}" "SELECTED\\${winPath}"`);
  });
  res.setHeader("Content-Disposition",`attachment; filename=${project.name.replace(/\s+/g,"_")}_selection.bat`);
  res.type("bat").send(lines.join("\r\n"));
});

/* ---------- Start ---------- */
app.listen(3000, ()=>console.log("✓ Server running on http://localhost:3000"));
