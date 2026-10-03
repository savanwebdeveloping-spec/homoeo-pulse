class AppConstants {
  static const String appName = 'Homoeo Pulse';
  static const String appTagline = 'Academic & Clinical Companion for BHMS';

  // BHMS Academic Years
  static const List<String> bhmsYears = [
    '1st Year',
    '2nd Year',
    '3rd Year',
    '4th Year',
    'Internship',
  ];

  // BHMS Curriculum Canonical Subjects by Year (NCH / AYUSH Syllabus)
  static const Map<String, List<Map<String, String>>> yearWiseSubjects = {
    '1st Year': [
      {
        'id': 'anat_1',
        'name': 'Anatomy',
        'code': 'ANAT-101',
        'icon': 'accessibility_new',
        'description': 'Gross anatomy, neuroanatomy, osteology & histological slides'
      },
      {
        'id': 'phys_1',
        'name': 'Physiology & Biochemistry',
        'code': 'PHYS-102',
        'icon': 'favorite',
        'description': 'Systemic physiology, haematology & biochemical pathways'
      },
      {
        'id': 'pharm_1',
        'name': 'Pharmacy',
        'code': 'PHARM-103',
        'icon': 'local_pharmacy',
        'description': 'Pharmacognosy, drug provings, potencies & scale preparation'
      },
      {
        'id': 'mm_1',
        'name': 'Materia Medica',
        'code': 'HMM-104',
        'icon': 'spa',
        'description': 'Polychrest remedies, introductory drug pictures & keynotes'
      },
      {
        'id': 'org_1',
        'name': 'Organon of Medicine and Homeopathic Philosophy',
        'code': 'ORG-105',
        'icon': 'menu_book',
        'description': 'Aphorisms 1-70, vital force, health, disease & cure'
      },
    ],
    '2nd Year': [
      {
        'id': 'path_2',
        'name': 'Pathology & Microbiology',
        'code': 'PATH-201',
        'icon': 'biotech',
        'description': 'General pathology, bacteriology, parasitology & virology'
      },
      {
        'id': 'fmt_2',
        'name': 'Forensic Medicine & Toxicology',
        'code': 'FMT-202',
        'icon': 'gavel',
        'description': 'Medical jurisprudence, post-mortem, toxicology & antidotes'
      },
      {
        'id': 'mm_2',
        'name': 'Materia Medica',
        'code': 'HMM-203',
        'icon': 'spa',
        'description': 'Comparative materia medica, gastrointestinal & respiratory remedies'
      },
      {
        'id': 'org_2',
        'name': 'Organon of Medicine and Homeopathic Philosophy',
        'code': 'ORG-204',
        'icon': 'menu_book',
        'description': 'Aphorisms 71-145, acute/chronic diseases, case taking'
      },
    ],
    '3rd Year': [
      {
        'id': 'surg_3',
        'name': 'Surgery',
        'code': 'SURG-301',
        'icon': 'healing',
        'description': 'General surgery, orthopaedics, ophthalmology, ENT & pre/post op remedies'
      },
      {
        'id': 'obg_3',
        'name': 'Obstetrics & Gynaecology',
        'code': 'OBG-302',
        'icon': 'pregnant_woman',
        'description': 'Normal/abnormal pregnancy, labor, gynaecological disorders & remedies'
      },
      {
        'id': 'mm_3',
        'name': 'Materia Medica',
        'code': 'HMM-303',
        'icon': 'spa',
        'description': 'Cardiovascular, renal, nervous & snake venoms'
      },
      {
        'id': 'org_3',
        'name': 'Organon of Medicine and Homeopathic Philosophy',
        'code': 'ORG-304',
        'icon': 'menu_book',
        'description': 'Aphorisms 146-291, chronic miasms (Psora, Sycosis, Syphilis)'
      },
    ],
    '4th Year': [
      {
        'id': 'pm_4',
        'name': 'Practice of Medicine',
        'code': 'PM-401',
        'icon': 'medical_services',
        'description': 'Internal medicine, neurology, cardiology, differential diagnosis & therapeutics'
      },
      {
        'id': 'rep_4',
        'name': 'Repertory',
        'code': 'REP-402',
        'icon': 'find_in_page',
        'description': 'Kent, Boenninghausen, Boger repertories, rubric analysis & computer repertorisation'
      },
      {
        'id': 'mm_4',
        'name': 'Materia Medica',
        'code': 'HMM-403',
        'icon': 'spa',
        'description': 'Rare remedies, nosodes, sarcodes & clinical comparisons'
      },
      {
        'id': 'org_4',
        'name': 'Organon of Medicine and Homeopathic Philosophy',
        'code': 'ORG-404',
        'icon': 'menu_book',
        'description': 'Kent\'s Lectures, Stuart Close, H.A. Roberts & Miasmatic prescribing'
      },
      {
        'id': 'cm_4',
        'name': 'Community Medicine',
        'code': 'CM-405',
        'icon': 'public',
        'description': 'Epidemiology, public health, national health programs & biostatistics'
      },
    ],
    'Internship': [
      {
        'id': 'clin_int',
        'name': 'Clinical Case Logs & Protocols',
        'code': 'INT-501',
        'icon': 'fact_check',
        'description': 'OPD/IPD management, emergency repertorisation & posology'
      },
      {
        'id': 'exam_prep',
        'name': 'MD Entrance / AIAPGET Prep',
        'code': 'INT-502',
        'icon': 'school',
        'description': 'High-yield MCQ question banks, previous year test papers & mnemonics'
      }
    ]
  };

  // Study Material Categories
  static const List<String> pdfCategories = [
    'All Material',
    'Handwritten Notes',
    'Standard Textbooks',
    'University Past Papers (PYQs)',
    'Important Rubrics & Charts',
    'Mnemonics & Quick Revision',
  ];

  // Hive Box Names
  static const String hiveBoxBookmarks = 'homoeo_pulse_bookmarks';
  static const String hiveBoxRecentReads = 'homoeo_pulse_recents';
  static const String hiveBoxOfflinePdfs = 'homoeo_pulse_offline_meta';
  static const String secureStorageKeyAlias = 'homoeo_pulse_aes_master_key';
}
