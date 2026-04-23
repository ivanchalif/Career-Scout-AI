import { db } from "@workspace/db";
import { jobPostingsTable, matchReportsTable } from "@workspace/db/schema";

const SEED_USER = "seed-demo";

const SAMPLE_POSTINGS = [
  {
    userId: SEED_USER,
    title: "Senior Full-Stack Engineer",
    company: "Acme Corp",
    source: "linkedin",
    link: "https://linkedin.com/jobs/123",
    fullDescription: `We are looking for a Senior Full-Stack Engineer to join our product team.

You will be responsible for building scalable web applications using React, TypeScript, and Node.js. Experience with PostgreSQL, Redis, and AWS is highly valued.

Requirements:
- 5+ years of software engineering experience
- Strong proficiency in TypeScript and React
- Experience with Node.js and Express
- PostgreSQL or another relational database
- Familiarity with CI/CD pipelines and Docker
- Excellent communication skills

Nice to have:
- GraphQL experience
- Experience with Kafka or other message queues
- Open-source contributions

Salary: $160,000 – $200,000/year`,
    salaryMin: 160000,
    salaryMax: 200000,
    extractedSkills: ["TypeScript", "React", "Node.js", "PostgreSQL", "Docker", "AWS", "Redis"],
  },
  {
    userId: SEED_USER,
    title: "Frontend Engineer",
    company: "TechStart Inc",
    source: "email",
    link: null,
    fullDescription: `TechStart is hiring a frontend-focused engineer to own our React component library and design system.

You'll work closely with design and product to ship high-quality features weekly.

Requirements:
- 3+ years React experience
- TypeScript expertise
- CSS/Tailwind proficiency
- Experience with testing (Playwright or Cypress)
- Attention to accessibility (WCAG 2.1)

Salary: $130,000 – $160,000`,
    salaryMin: 130000,
    salaryMax: 160000,
    extractedSkills: ["React", "TypeScript", "Tailwind", "Playwright", "CSS"],
  },
  {
    userId: SEED_USER,
    title: "Backend Engineer (Rust/Go)",
    company: "Infra Systems LLC",
    source: "email",
    link: "https://infrasystems.io/careers/backend",
    fullDescription: `We build high-performance distributed systems. We need an engineer who can write Rust or Go and cares deeply about performance and reliability.

Responsibilities:
- Design and implement high-throughput data pipelines
- Own service reliability (SLOs, on-call)
- Collaborate with platform team

Requirements:
- 4+ years backend engineering
- Rust or Go (we use both)
- gRPC and Protocol Buffers
- Kubernetes, Terraform

Salary: $180,000 – $220,000`,
    salaryMin: 180000,
    salaryMax: 220000,
    extractedSkills: ["Rust", "Go", "gRPC", "Kubernetes", "Terraform"],
  },
  {
    userId: SEED_USER,
    title: "Staff Engineer – Platform",
    company: "ScaleUp AI",
    source: "linkedin",
    link: "https://linkedin.com/jobs/456",
    fullDescription: `ScaleUp AI is looking for a Staff Engineer to lead our platform engineering efforts.

You'll drive technical strategy across our backend services, mentor senior engineers, and own cross-cutting concerns like observability, developer experience, and infrastructure.

Requirements:
- 8+ years software engineering, 3+ at Staff level or equivalent
- Deep knowledge of distributed systems
- Experience with Python and TypeScript
- Kubernetes, Terraform, and cloud infrastructure (AWS or GCP)
- Strong written communication

Salary: $220,000 – $270,000`,
    salaryMin: 220000,
    salaryMax: 270000,
    extractedSkills: ["Python", "TypeScript", "Kubernetes", "Terraform", "AWS", "GCP", "Distributed Systems"],
  },
  {
    userId: SEED_USER,
    title: "ML Engineer",
    company: "DataDriven Co",
    source: "email",
    link: null,
    fullDescription: `Join our ML team to build and deploy machine learning models at scale.

You'll collaborate with data scientists to take models from prototype to production.

Requirements:
- Python proficiency
- PyTorch or TensorFlow experience
- MLflow or similar for experiment tracking
- Experience with model serving (FastAPI, TorchServe)
- SQL and data pipeline experience

Salary: $150,000 – $190,000`,
    salaryMin: 150000,
    salaryMax: 190000,
    extractedSkills: ["Python", "PyTorch", "TensorFlow", "MLflow", "FastAPI", "SQL"],
  },
];

const SAMPLE_REPORTS = [
  {
    postingIndex: 0,
    fitScore: 87,
    matchedSkills: ["TypeScript", "React", "Node.js", "PostgreSQL"],
    missingSkills: ["Redis", "AWS"],
    reasoning:
      "Strong alignment on core stack. Candidate has solid full-stack experience with React and Node.js. Missing cloud and caching experience but these are learnable. Salary range aligns well with target.",
    compensationGap: 15000,
  },
  {
    postingIndex: 1,
    fitScore: 72,
    matchedSkills: ["React", "TypeScript", "CSS"],
    missingSkills: ["Tailwind", "Playwright"],
    reasoning:
      "Good frontend fundamentals match. Candidate may need to pick up Tailwind and Playwright testing frameworks, but the core React and TypeScript skills are there.",
    compensationGap: -10000,
  },
  {
    postingIndex: 3,
    fitScore: 61,
    matchedSkills: ["TypeScript", "AWS"],
    missingSkills: ["Python", "Kubernetes", "Terraform", "GCP"],
    reasoning:
      "Moderate fit. The candidate has TypeScript and cloud experience but lacks the Python background and infrastructure tooling expected at Staff level.",
    compensationGap: 55000,
  },
];

async function seed() {
  console.log("Seeding database with sample job postings...");

  const inserted = await db
    .insert(jobPostingsTable)
    .values(SAMPLE_POSTINGS)
    .returning({ id: jobPostingsTable.id });

  console.log(`Inserted ${inserted.length} job postings`);

  const reportValues = SAMPLE_REPORTS.map((r) => ({
    jobPostingId: inserted[r.postingIndex].id,
    userId: SEED_USER,
    fitScore: r.fitScore,
    matchedSkills: r.matchedSkills,
    missingSkills: r.missingSkills,
    reasoning: r.reasoning,
    compensationGap: r.compensationGap,
  }));

  await db.insert(matchReportsTable).values(reportValues);
  console.log(`Inserted ${reportValues.length} match reports`);

  console.log("Seed complete!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
