export function answerSmallTalk(message) {
  const text = String(message || '').trim().toLowerCase().replace(/[.!?؟।]+$/u, '').trim();
  const inBangla = /[\u0980-\u09FF]/.test(text);

  if (/^(?:hi|hello|hey|hey there|hi there|good morning|good afternoon|good evening|হ্যালো|হাই|আসসালামু আলাইকুম|সালাম)$/.test(text)) {
    return inBangla
      ? 'হ্যালো! 👋 আমি JUPTEE-এর শপিং অ্যাসিস্ট্যান্ট। পোশাকের ডিজাইন, প্রকাশিত দাম ও সাইজ, ডেলিভারি এবং অর্ডার সম্পর্কে সাহায্য করতে পারি। কী জানতে চান?'
      : 'Hi! 👋 I’m JUPTEE’s shopping assistant. I can help you explore styles, check published prices and sizes, or answer delivery and order questions. What can I help you find?';
  }
  if (/^(?:how are you|how are you doing|how(?:’|')s it going|what(?:’|')s up|কেমন আছেন|কেমন আছো)$/.test(text)) {
    return inBangla
      ? 'ভালো আছি, ধন্যবাদ! 😊 JUPTEE-এর পোশাক, সাইজ, দাম, ডেলিভারি বা অর্ডার নিয়ে সাহায্য করতে পারি। কী জানতে চান?'
      : 'I’m doing well, thanks for asking! 😊 I’m here to help with JUPTEE styles, sizes, prices, delivery, and orders. What are you looking for?';
  }
  if (/^(?:thanks|thank you|thanks a lot|thank you so much|ধন্যবাদ|অনেক ধন্যবাদ)$/.test(text)) {
    return inBangla
      ? 'আপনাকে স্বাগতম! 😊 আর কিছু জানতে চাইলে বলুন।'
      : 'You’re welcome! 😊 If you need anything else, just ask.';
  }
  if (/^(?:bye|goodbye|see you|take care|আল্লাহ হাফেজ|বিদায়|বিদায়)$/.test(text)) {
    return inBangla
      ? 'আল্লাহ হাফেজ! 👋 JUPTEE-তে আবার আসার জন্য ধন্যবাদ।'
      : 'Goodbye! 👋 Thanks for visiting JUPTEE. Come back anytime.';
  }
  if (/^(?:help|who are you|what can you do|কীভাবে সাহায্য করতে পারেন|কি সাহায্য করতে পারেন)$/.test(text)) {
    return inBangla
      ? 'আমি JUPTEE-এর শপিং অ্যাসিস্ট্যান্ট। পোশাকের ডিজাইন, প্রকাশিত দাম ও সাইজ, ডেলিভারি এবং অর্ডার নিয়ে সাহায্য করতে পারি।'
      : 'I’m JUPTEE’s shopping assistant. I can help you find styles, check published prices and sizes, and answer delivery or order questions.';
  }
  return '';
}
