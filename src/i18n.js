/* ============================================================================
 * src/i18n.js — interface strings.
 *
 * To add a language: copy the `en` block, translate the values (never the
 * keys), and set `language` in course.config.js to your new code. Add the code
 * to RTL_LANGUAGES below if it is written right-to-left.
 *
 * Course CONTENT (questions, day titles, the course name) is not translated
 * here — it comes from course.config.js and content/*.csv, so a deployment
 * simply writes those in its own language.
 * ==========================================================================*/
(function (global) {
  'use strict';

  var RTL_LANGUAGES = ['ar', 'he', 'fa', 'ur'];

  var STRINGS = {
    en: {
      dir: 'ltr',
      appTitle: 'Course Portal',
      demoBanner: 'DEMO MODE — everything you do is stored only in this browser. No server, no real data. Use “Reset demo” to start over.',
      demoReset: 'Reset demo',
      demoResetConfirm: 'Delete all demo data in this browser and start over?',

      navHome: 'Home', navDashboard: 'My status', navAdmin: 'Admin', navSignOut: 'Sign out',

      signIn: 'Sign in', signUp: 'Register', email: 'Email address',
      password: 'Password', passwordConfirm: 'Confirm password',
      fullName: 'Full name',
      haveAccount: 'Already registered? Sign in',
      noAccount: 'New here? Register',
      signingIn: 'Signing in…', registering: 'Registering…',
      signInFailed: 'Could not sign in. Check your email address and password.',
      emailInUse: 'That email address is already registered. Try signing in instead.',
      passwordTooShort: 'Password must be at least {n} characters.',
      passwordsDiffer: 'The two passwords do not match.',
      passwordWeak: 'Choose a stronger password: use at least {n} characters and mix letters with numbers or symbols.',
      confirmEmailNotice: 'Almost there. We have sent a confirmation link to {email}. Open it to activate your account, then come back and sign in.',
      emailNotConfirmed: 'Your email address has not been confirmed yet. Please open the confirmation link we sent you.',

      yourCode: 'Your participant code',
      yourCodeExplain: 'This code was issued by the server and links all of your records. You never need to type it.',

      registrationClosed: 'Registration is closed.',
      componentNotOpen: 'Not open yet. Opens {when}.',
      componentClosed: 'Closed {when}.',
      componentOpenUntil: 'Open until {when}.',
      componentOpen: 'Open now.',
      allTimesIn: 'All times shown in {tz}.',

      attendance: 'Attendance', attendanceCheckIn: 'Check in',
      attendanceRecorded: 'Checked in at {when}',
      attendanceNotRecorded: 'Not checked in',
      attendanceDone: 'Attendance recorded. Thank you.',

      preTest: 'Pre-test', postTest: 'Post-test', feedback: 'Feedback',
      questionCount: '{n} question(s)',
      startTest: 'Start', submit: 'Submit', submitting: 'Submitting…',
      alreadySubmitted: 'You have already submitted this. Responses cannot be changed.',
      unanswered: 'Please answer every required question. {n} still unanswered.',
      confirmSubmit: 'Submit your answers? They cannot be changed afterwards.',
      submitted: 'Submitted. Thank you.',
      requiredMark: 'required',

      likert1: 'Strongly disagree', likert2: 'Disagree', likert3: 'Neutral',
      likert4: 'Agree', likert5: 'Strongly agree',

      resultsTitle: 'Your results',
      resultsPre: 'Pre-test', resultsPost: 'Post-test', resultsChange: 'Change',
      resultsBasis: 'Based on the {n} question(s) that appeared in both tests.',
      resultsGained: 'Newly correct', resultsLost: 'Newly incorrect',
      resultsKept: 'Correct both times', resultsUnchanged: 'Incorrect both times',
      reviewTitle: 'Question by question',
      yourAnswerPre: 'Your pre-test answer', yourAnswerPost: 'Your post-test answer',
      correctAnswer: 'Correct answer', notAnswered: 'Not answered',
      resultsHiddenPre: 'Your pre-test has been recorded. Scores are shown after the post-test.',

      dashboard: 'My status', progress: 'Progress',
      certificate: 'Certificate', certificateEligible: 'You meet all requirements for a certificate.',
      certificateNotEligible: 'Not yet eligible. Outstanding:',
      certificateNote: 'Eligibility is calculated by the server from your records. Issuing the certificate itself is done by the course organisers.',
      statusDone: 'Done', statusPending: 'Pending', statusUnavailable: 'Not available',

      adminTitle: 'Administration', adminWindows: 'Component windows',
      adminOverrideOpen: 'Force open', adminOverrideClose: 'Force closed',
      adminOverrideAuto: 'Follow schedule',
      adminScheduled: 'Scheduled', adminEffective: 'Now',
      adminSync: 'Publish schedule to server',
      adminSyncDone: 'Schedule published. The server now enforces the same times as course.config.js.',
      adminProgress: 'Participants', adminExports: 'Exports',
      adminExportResearch: 'Research export (no identifiers)',
      adminExportOperations: 'Operations export (identifiers)',
      adminExportDictionary: 'Column dictionary',
      adminNoAccess: 'This account is not an administrator.',
      adminCounts: '{n} participant(s)',

      loading: 'Loading…', error: 'Something went wrong',
      contentError: 'The course content files could not be loaded.',
      configError: 'Configuration problem',
      close: 'Close', cancel: 'Cancel', back: 'Back'
    },

    ar: {
      dir: 'rtl',
      appTitle: 'بوابة الدورة',
      demoBanner: 'وضع التجربة — كل ما تفعله يُحفظ في هذا المتصفح فقط. لا يوجد خادم ولا بيانات حقيقية.',
      demoReset: 'إعادة ضبط التجربة',
      demoResetConfirm: 'حذف كل بيانات التجربة في هذا المتصفح والبدء من جديد؟',

      navHome: 'الرئيسية', navDashboard: 'حالتي', navAdmin: 'الإدارة', navSignOut: 'تسجيل الخروج',

      signIn: 'تسجيل الدخول', signUp: 'التسجيل', email: 'البريد الإلكتروني',
      password: 'كلمة المرور', passwordConfirm: 'تأكيد كلمة المرور',
      fullName: 'الاسم الكامل',
      haveAccount: 'مسجل بالفعل؟ سجّل الدخول',
      noAccount: 'مستخدم جديد؟ سجّل الآن',
      signingIn: 'جارٍ تسجيل الدخول…', registering: 'جارٍ التسجيل…',
      signInFailed: 'تعذر تسجيل الدخول. تحقق من البريد الإلكتروني وكلمة المرور.',
      emailInUse: 'هذا البريد الإلكتروني مسجل بالفعل. جرّب تسجيل الدخول.',
      passwordTooShort: 'يجب ألا تقل كلمة المرور عن {n} حرفًا.',
      passwordsDiffer: 'كلمتا المرور غير متطابقتين.',
      passwordWeak: 'اختر كلمة مرور أقوى: {n} حرفًا على الأقل مع مزج الحروف بالأرقام أو الرموز.',
      confirmEmailNotice: 'أرسلنا رابط تأكيد إلى {email}. افتحه لتفعيل حسابك ثم عد لتسجيل الدخول.',
      emailNotConfirmed: 'لم يتم تأكيد بريدك الإلكتروني بعد. افتح رابط التأكيد المرسل إليك.',

      yourCode: 'رمز المشارك الخاص بك',
      yourCodeExplain: 'أصدر الخادم هذا الرمز وهو يربط جميع سجلاتك. لست بحاجة إلى كتابته أبدًا.',

      registrationClosed: 'التسجيل مغلق.',
      componentNotOpen: 'لم يُفتح بعد. يفتح {when}.',
      componentClosed: 'أُغلق {when}.',
      componentOpenUntil: 'مفتوح حتى {when}.',
      componentOpen: 'مفتوح الآن.',
      allTimesIn: 'جميع الأوقات بتوقيت {tz}.',

      attendance: 'الحضور', attendanceCheckIn: 'تسجيل الحضور',
      attendanceRecorded: 'سُجل الحضور في {when}',
      attendanceNotRecorded: 'لم يُسجل الحضور',
      attendanceDone: 'تم تسجيل الحضور. شكرًا لك.',

      preTest: 'الاختبار القبلي', postTest: 'الاختبار البعدي', feedback: 'التقييم',
      questionCount: 'عدد الأسئلة: {n}',
      startTest: 'ابدأ', submit: 'إرسال', submitting: 'جارٍ الإرسال…',
      alreadySubmitted: 'لقد أرسلت هذا بالفعل. لا يمكن تغيير الإجابات.',
      unanswered: 'يرجى الإجابة على جميع الأسئلة المطلوبة. تبقى {n}.',
      confirmSubmit: 'إرسال إجاباتك؟ لا يمكن تغييرها بعد ذلك.',
      submitted: 'تم الإرسال. شكرًا لك.',
      requiredMark: 'مطلوب',

      likert1: 'غير موافق بشدة', likert2: 'غير موافق', likert3: 'محايد',
      likert4: 'موافق', likert5: 'موافق بشدة',

      resultsTitle: 'نتائجك',
      resultsPre: 'الاختبار القبلي', resultsPost: 'الاختبار البعدي', resultsChange: 'التغير',
      resultsBasis: 'بناءً على {n} سؤالًا ظهرت في الاختبارين.',
      resultsGained: 'صحيحة حديثًا', resultsLost: 'خاطئة حديثًا',
      resultsKept: 'صحيحة في المرتين', resultsUnchanged: 'خاطئة في المرتين',
      reviewTitle: 'سؤالًا سؤالًا',
      yourAnswerPre: 'إجابتك القبلية', yourAnswerPost: 'إجابتك البعدية',
      correctAnswer: 'الإجابة الصحيحة', notAnswered: 'بدون إجابة',
      resultsHiddenPre: 'تم تسجيل اختبارك القبلي. تظهر الدرجات بعد الاختبار البعدي.',

      dashboard: 'حالتي', progress: 'التقدم',
      certificate: 'الشهادة', certificateEligible: 'أنت مستوفٍ لجميع شروط الشهادة.',
      certificateNotEligible: 'غير مستوفٍ بعد. المتبقي:',
      certificateNote: 'يحسب الخادم الأهلية من سجلاتك. أما إصدار الشهادة فيتم من قبل منظمي الدورة.',
      statusDone: 'مكتمل', statusPending: 'قيد الانتظار', statusUnavailable: 'غير متاح',

      adminTitle: 'الإدارة', adminWindows: 'نوافذ المكونات',
      adminOverrideOpen: 'فتح إجباري', adminOverrideClose: 'إغلاق إجباري',
      adminOverrideAuto: 'حسب الجدول',
      adminScheduled: 'المجدول', adminEffective: 'الآن',
      adminSync: 'نشر الجدول إلى الخادم',
      adminSyncDone: 'تم نشر الجدول. يطبق الخادم الآن نفس الأوقات.',
      adminProgress: 'المشاركون', adminExports: 'التصدير',
      adminExportResearch: 'تصدير بحثي (بدون معرفات)',
      adminExportOperations: 'تصدير تشغيلي (يتضمن معرفات)',
      adminExportDictionary: 'قاموس الأعمدة',
      adminNoAccess: 'هذا الحساب ليس حساب مسؤول.',
      adminCounts: '{n} مشارك',

      loading: 'جارٍ التحميل…', error: 'حدث خطأ',
      contentError: 'تعذر تحميل ملفات محتوى الدورة.',
      configError: 'مشكلة في الإعدادات',
      close: 'إغلاق', cancel: 'إلغاء', back: 'رجوع'
    }
  };

  function create(lang) {
    var code = STRINGS[lang] ? lang : 'en';
    var table = STRINGS[code];
    var fallback = STRINGS.en;

    function t(key, vars) {
      var s = table[key];
      if (s === undefined) s = fallback[key];
      if (s === undefined) return key;
      if (vars) {
        Object.keys(vars).forEach(function (k) {
          s = s.split('{' + k + '}').join(String(vars[k]));
        });
      }
      return s;
    }

    return {
      lang: code,
      dir: RTL_LANGUAGES.indexOf(code) !== -1 ? 'rtl' : 'ltr',
      t: t,
      available: Object.keys(STRINGS)
    };
  }

  var I18n = { create: create, STRINGS: STRINGS, RTL_LANGUAGES: RTL_LANGUAGES };

  global.CP = global.CP || {};
  global.CP.I18n = I18n;
  if (typeof module !== 'undefined' && module.exports) module.exports = I18n;
})(typeof globalThis !== 'undefined' ? globalThis : this);
