// dashboard.js
/**
 * Student Dashboard API and Controller Helper
 * Fully synchronized with database schema and backend endpoints:
 * - /api/student-progress?student_id=...
 * - /api/admin-dashboard (for course final exam countdown)
 * - /api/exams?user_id=...
 * - /api/homeworks?user_id=...
 * - /api/files
 * - /api/announcements
 * - /api/meetings
 * - /api/pastpapers
 * - /api/videos
 */

const motivationalQuotes = [
  '"Success is the sum of small efforts, repeated day in and day out." – Robert Collier',
  '"The expert in anything was once a beginner. Keep going!"',
  '"Education is the passport to the future, for tomorrow belongs to those who prepare for it today." – Malcolm X',
  '"Don\'t watch the clock; do what it does. Keep going." – Sam Levenson',
  '"You don\'t have to be extreme, just consistent."',
];

document.addEventListener("DOMContentLoaded", () => {
  console.log("[Dashboard] DOM fully loaded and parsed.");

  const userJson = localStorage.getItem("user");
  const user = JSON.parse(userJson || "{}");
  if (!user.id || !user.full_name) {
    console.warn(
      "[Dashboard] No valid user found in localStorage. Redirecting...",
    );
    window.location.href = "index.html";
    return;
  }

  const welcomeTitleEl = document.getElementById("welcomeTitle");
  if (welcomeTitleEl)
    welcomeTitleEl.textContent = `Welcome back, ${user.full_name.split(" ")[0]}!`;

  loadStudentDashboardData(user);
});

async function loadStudentDashboardData(user) {
  async function safeFetch(url, fallbackData) {
    try {
      const res = await fetch(url);
      if (!res.ok) return fallbackData;
      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json"))
        return fallbackData;
      return await res.json();
    } catch (err) {
      console.error(`[Fetch Error] ${url}:`, err);
      return fallbackData;
    }
  }

  try {
    const [
      progressRes,
      allStudentsRes,
      filesRes,
      announcementsRes,
      meetingsRes,
      pastpapersRes,
      videosRes,
      examsRes,
      homeworksRes,
      adminDashRes,
    ] = await Promise.all([
      safeFetch(`/api/student-progress?student_id=${user.id}`, null),
      safeFetch(`/api/student-progress`, []),
      safeFetch(`/api/files`, { files: [] }),
      safeFetch(`/api/announcements`, []),
      safeFetch(`/api/meetings`, []),
      safeFetch(`/api/pastpapers`, []),
      safeFetch(`/api/videos`, []),
      safeFetch(`/api/exams?user_id=${user.id}`, []),
      safeFetch(`/api/homeworks?user_id=${user.id}`, []),
      safeFetch(`/api/admin-dashboard`, null),
    ]);

    if (!progressRes || !progressRes.student) {
      const examContainer = document.getElementById("latestExamCardContent");
      if (examContainer) {
        examContainer.innerHTML = `
          <p class="text-sm text-red-600">Failed to load student progress from database.</p>
        `;
      }
      return;
    }

    const exams = progressRes.exams || examsRes || [];
    const homeworks = progressRes.homeworks || homeworksRes || [];
    const files = filesRes.files || filesRes || [];
    const announcements = announcementsRes || [];
    const meetings = meetingsRes || [];
    const pastpapers = pastpapersRes || [];
    const videos = videosRes || [];
    const allStudents = Array.isArray(allStudentsRes) ? allStudentsRes : [];

    // Extract final exam date from admin dashboard course settings or student progress if available
    let finalExamDate = null;
    if (
      adminDashRes &&
      adminDashRes.course &&
      adminDashRes.course.next_final_exam_date
    ) {
      finalExamDate = adminDashRes.course.next_final_exam_date;
    } else if (adminDashRes && adminDashRes.next_final_exam_date) {
      finalExamDate = adminDashRes.next_final_exam_date;
    } else if (progressRes.course && progressRes.course.next_final_exam_date) {
      finalExamDate = progressRes.course.next_final_exam_date;
    }

    processLatestGradedExam(exams);
    processLatestHomework(homeworks);
    processLatestUploads(files, announcements, meetings, pastpapers, videos);
    processLeaderboardAndStanding(allStudents, user.id);
    initExamCountdown(finalExamDate);
  } catch (err) {
    console.error("[Dashboard Critical Error]:", err);
    const examContainer = document.getElementById("latestExamCardContent");
    if (examContainer) {
      examContainer.innerHTML = `
        <p class="text-sm text-red-600">Failed to parse dashboard data. Check browser console (F12) for error details.</p>
      `;
    }
  }
}

function initExamCountdown(examDateString) {
  const countdownEl = document.getElementById("countdownTimerText");
  if (!countdownEl) return;

  if (!examDateString) {
    countdownEl.textContent = "No final exam scheduled";
    return;
  }

  const examTime = new Date(examDateString).getTime();

  function updateTimer() {
    const now = new Date().getTime();
    const distance = examTime - now;

    if (distance < 0) {
      countdownEl.textContent = "Exam time reached / completed";
      return;
    }

    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
    const hours = Math.floor(
      (distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
    );
    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((distance % (1000 * 60)) / 1000);

    countdownEl.textContent = `${days}d ${hours}h ${minutes}m ${seconds}s`;
  }

  updateTimer();
  setInterval(updateTimer, 1000);
}

function processLatestGradedExam(exams) {
  const container = document.getElementById("latestExamCardContent");
  if (!container) return;

  const gradedExams = exams.filter(
    (e) => e.numeric_grade !== null && e.numeric_grade !== undefined,
  );

  gradedExams.sort(
    (a, b) =>
      new Date(b.exam_date || b.created_at || 0) -
      new Date(a.exam_date || a.created_at || 0),
  );

  if (gradedExams.length === 0) {
    container.innerHTML = `
      <div class="py-6 text-center text-sm text-[#64748B]">
        No exams have been graded for you yet. Check back soon!
      </div>
    `;
    const scoreEl = document.getElementById("metricLatestExamScore");
    const titleEl = document.getElementById("metricLatestExamTitle");
    if (scoreEl) scoreEl.textContent = "—";
    if (titleEl) titleEl.textContent = "No graded exams";
    return;
  }

  const latest = gradedExams[0];
  const score = latest.numeric_grade;
  const total = latest.total_grade || 100;
  const gradeLetter = latest.letter_grade || "—";
  const comment = latest.comment || "Great effort! Keep up the good work.";
  const examTitle = latest.title || latest.exam_title || "Exam Assessment";

  const scoreEl = document.getElementById("metricLatestExamScore");
  const titleEl = document.getElementById("metricLatestExamTitle");
  if (scoreEl) scoreEl.textContent = `${score} / ${total}`;
  if (titleEl) titleEl.textContent = examTitle;

  let badgeColor = "bg-slate-100 text-slate-700 border-slate-200";
  if (gradeLetter === "A")
    badgeColor = "bg-emerald-50 text-emerald-700 border-emerald-200";
  else if (gradeLetter === "B")
    badgeColor = "bg-teal-50 text-teal-700 border-teal-200";
  else if (gradeLetter === "C")
    badgeColor = "bg-amber-50 text-amber-700 border-amber-200";
  else if (gradeLetter === "D")
    badgeColor = "bg-orange-50 text-orange-700 border-orange-200";
  else if (gradeLetter === "F")
    badgeColor = "bg-red-50 text-red-700 border-red-200";

  container.innerHTML = `
    <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 bg-[#F8FAFC] rounded-xl border border-[#E2E8F0]">
      <div>
        <span class="px-2.5 py-0.5 bg-teal-50 text-teal-700 border border-teal-200 rounded text-xs font-semibold uppercase">${latest.type || "Exam"}</span>
        <h4 class="font-bold text-[#0F172A] text-base mt-1.5">${examTitle}</h4>
        <p class="text-xs text-[#64748B] mt-1">Instructor Feedback: <span class="italic text-[#0F172A]">"${comment}"</span></p>
      </div>
      <div class="flex items-center gap-4 self-end sm:self-center">
        <div class="text-right">
          <span class="block text-[10px] uppercase font-bold text-[#64748B]">Score</span>
          <span class="text-lg font-bold text-[#0F172A]">${score} <span class="text-xs text-[#64748B]">/ ${total}</span></span>
        </div>
        <div class="px-3 py-1.5 rounded-lg border font-bold text-sm ${badgeColor}">
          ${gradeLetter}
        </div>
      </div>
    </div>
  `;
}

function processLatestHomework(homeworks) {
  const container = document.getElementById("latestHomeworkCardContent");
  if (!container) return;

  const pendingHomeworks = homeworks.filter(
    (h) => h.status === "missing" || h.status === "not_submitted" || !h.status,
  );
  const pendingEl = document.getElementById("metricPendingHomeworks");
  if (pendingEl) pendingEl.textContent = pendingHomeworks.length;

  homeworks.sort(
    (a, b) =>
      new Date(b.deadline || b.created_at || 0) -
      new Date(a.deadline || a.created_at || 0),
  );

  if (homeworks.length === 0) {
    container.innerHTML = `
      <div class="py-6 text-center text-sm text-[#64748B]">
        No homework assignments posted yet.
      </div>
    `;
    return;
  }

  const latest = homeworks[0];
  let deadlineFormatted = "No deadline";
  if (latest.deadline) {
    deadlineFormatted = new Date(latest.deadline).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const isSubmitted = latest.status === "submitted";
  const hwTitle =
    latest.title || latest.homework_title || "Homework Assignment";

  container.innerHTML = `
    <div class="p-4 bg-[#F8FAFC] rounded-xl border border-[#E2E8F0] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
      <div>
        <span class="px-2.5 py-0.5 ${isSubmitted ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"} rounded text-xs font-semibold">
          ${isSubmitted ? "Submitted" : "Active Assignment"}
        </span>
        <h4 class="font-bold text-[#0F172A] text-base mt-1.5">${hwTitle}</h4>
        <p class="text-xs text-[#64748B] mt-1">Deadline: <span class="font-medium text-[#0F172A]">${deadlineFormatted}</span></p>
        ${latest.admin_comment ? `<p class="text-xs text-[#64748B] mt-1">Feedback: <span class="italic text-[#0F172A]">"${latest.admin_comment}"</span></p>` : ""}
      </div>
      <a href="homeworks.html" class="px-4 py-2 bg-[#0D9488] hover:bg-[#0f766e] text-white text-xs font-semibold rounded-xl transition-colors shadow-sm self-start sm:self-center">
        ${isSubmitted ? "View Submission" : "Submit Work"}
      </a>
    </div>
  `;
}

function processLatestUploads(
  files,
  announcements,
  meetings,
  pastpapers,
  videos,
) {
  const container = document.getElementById("latestUploadsList");
  if (!container) return;

  const combined = [
    ...files.map((f) => ({
      type: "file",
      title: f.title || f.name,
      date: f.created_at,
      desc: f.description || "Study document",
      link: f.file_path || f.url || "#",
    })),
    ...announcements.map((a) => ({
      type: "announcement",
      title: a.title,
      date: a.created_at,
      desc: a.description,
      link: "#",
    })),
    ...meetings.map((m) => ({
      type: "meeting",
      title: m.title,
      date: m.meeting_date || m.created_at,
      desc: `Scheduled meeting (${m.hours || 1} hrs)`,
      link: m.url || "#",
    })),
    ...pastpapers.map((p) => ({
      type: "pastpaper",
      title: p.title,
      date: p.created_at,
      desc: `Past Paper (${p.month} ${p.year})`,
      link: p.paper || "#",
    })),
    ...videos.map((v) => ({
      type: "video",
      title: v.title,
      date: v.created_at,
      desc: "Recorded lecture video",
      link: v.url || "#",
    })),
  ];

  combined.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  const topUploads = combined.slice(0, 4);

  const totalUploadsEl = document.getElementById("metricTotalUploads");
  if (totalUploadsEl) {
    totalUploadsEl.textContent =
      files.length +
      announcements.length +
      meetings.length +
      pastpapers.length +
      videos.length;
  }

  if (topUploads.length === 0) {
    container.innerHTML = `
      <div class="py-6 text-center text-sm text-[#64748B]">
        No recent uploads or announcements.
      </div>
    `;
    return;
  }

  container.innerHTML = "";
  topUploads.forEach((item) => {
    let badgeClass = "bg-blue-50 text-blue-700 border-blue-200";
    let badgeText = "File";
    let iconColor = "bg-blue-50 text-blue-600";

    if (item.type === "announcement") {
      badgeClass = "bg-purple-50 text-purple-700 border-purple-200";
      badgeText = "Announcement";
      iconColor = "bg-purple-50 text-purple-600";
    } else if (item.type === "meeting") {
      badgeClass = "bg-emerald-50 text-emerald-700 border-emerald-200";
      badgeText = "Meeting";
      iconColor = "bg-emerald-50 text-emerald-600";
    } else if (item.type === "pastpaper") {
      badgeClass = "bg-amber-50 text-amber-700 border-amber-200";
      badgeText = "Past Paper";
      iconColor = "bg-amber-50 text-amber-600";
    } else if (item.type === "video") {
      badgeClass = "bg-rose-50 text-rose-700 border-rose-200";
      badgeText = "Video";
      iconColor = "bg-rose-50 text-rose-600";
    }

    container.innerHTML += `
      <div class="p-3.5 bg-[#F8FAFC] rounded-xl border border-[#E2E8F0] flex items-center justify-between gap-4 hover:border-[#0D9488] transition-colors">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg ${iconColor} flex items-center justify-center flex-shrink-0">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h5 class="font-bold text-xs text-[#0F172A]">${item.title}</h5>
              <span class="px-2 py-0.5 ${badgeClass} border rounded text-[10px] font-semibold">${badgeText}</span>
            </div>
            <p class="text-[11px] text-[#64748B] mt-0.5 line-clamp-1">${item.desc || "No description provided"}</p>
          </div>
        </div>
        ${item.link && item.link !== "#" ? `<a href="${item.link}" target="_blank" class="text-xs font-semibold text-[#0D9488] hover:underline flex-shrink-0">Open</a>` : ""}
      </div>
    `;
  });
}

function processLeaderboardAndStanding(allStudents, currentUserId) {
  const ranked = [...allStudents].sort((a, b) => {
    const scoreA = (a.graded_exams || 0) * 10 + (a.submitted_homeworks || 0);
    const scoreB = (b.graded_exams || 0) * 10 + (b.submitted_homeworks || 0);
    return scoreB - scoreA;
  });

  let userRank = ranked.findIndex((s) => s.user_id === currentUserId) + 1;
  if (userRank === 0) userRank = ranked.length || 1;

  const statUserRankEl = document.getElementById("statUserRank");
  if (statUserRankEl) statUserRankEl.textContent = `#${userRank}`;

  const top3Container = document.getElementById("topPerformersList");
  if (top3Container) {
    const top3 = ranked.slice(0, 3);

    if (top3.length === 0) {
      top3Container.innerHTML = `
        <div class="py-6 text-center text-sm text-[#64748B]">
          Leaderboard will populate as student activity is recorded.
        </div>
      `;
    } else {
      top3Container.innerHTML = "";
      top3.forEach((student, index) => {
        const rankColors = [
          "bg-amber-100 text-amber-800 border-amber-300",
          "bg-slate-200 text-slate-800 border-slate-300",
          "bg-orange-100 text-orange-800 border-orange-300",
        ];
        const isMe = student.user_id === currentUserId;

        top3Container.innerHTML += `
          <div class="flex items-center justify-between p-3.5 rounded-xl border ${isMe ? "bg-teal-50/50 border-[#0D9488]" : "bg-[#F8FAFC] border-[#E2E8F0]"}" ${isMe ? 'style="box-shadow: 0 0 0 1px #0D9488;"' : ""}>
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-full border flex items-center justify-center font-bold text-xs ${rankColors[index] || "bg-slate-100 text-slate-700"}">
                ${index + 1}
              </div>
              <div>
                <h5 class="font-bold text-xs text-[#0F172A]">${student.full_name} ${isMe ? '<span class="text-[10px] text-[#0D9488] font-bold">(You)</span>' : ""}</h5>
                <p class="text-[10px] text-[#64748B]">${student.school_name || "Student"}</p>
              </div>
            </div>
            <div class="text-right">
              <span class="text-xs font-bold text-[#0F172A]">${student.graded_exams || 0} Graded Exams</span>
            </div>
          </div>
        `;
      });
    }
  }

  const bannerHeading = document.getElementById("bannerHeading");
  const bannerText = document.getElementById("bannerText");
  const bannerTag = document.getElementById("bannerTag");
  const metricStandingSub = document.getElementById("metricStandingSub");
  const metricClassStanding = document.getElementById("metricClassStanding");

  const isInTop3 = userRank >= 1 && userRank <= 3;

  if (isInTop3) {
    if (bannerTag) {
      bannerTag.innerHTML = `
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"/>
        </svg>
        Top Performer Recognition
      `;
    }
    if (bannerHeading)
      bannerHeading.textContent = `Outstanding job! You are in the Top 3 (Rank #${userRank} Place)!`;
    if (bannerText)
      bannerText.textContent = `Your dedication and hard work have earned you a spot among the elite performers in your class. Keep inspiring others!`;
    if (metricClassStanding)
      metricClassStanding.textContent = `Rank #${userRank}`;
    if (metricStandingSub)
      metricStandingSub.textContent = "Podium Honor Student";
  } else {
    const randomQuote =
      motivationalQuotes[Math.floor(Math.random() * motivationalQuotes.length)];
    if (bannerTag) {
      bannerTag.innerHTML = `
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
        </svg>
        Daily Academic Motivation
      `;
    }
    if (bannerHeading)
      bannerHeading.textContent = `Keep pushing forward, you are doing great!`;
    if (bannerText) bannerText.textContent = randomQuote;
    if (metricClassStanding)
      metricClassStanding.textContent = `Rank #${userRank}`;
    if (metricStandingSub)
      metricStandingSub.textContent = "Keep climbing the podium";
  }
}
