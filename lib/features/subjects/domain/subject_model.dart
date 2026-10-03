class SubjectModel {
  final String id;
  final String name;
  final String code;
  final String year;
  final String description;
  final String icon;
  final int pdfCount;
  final int sortOrder;

  SubjectModel({
    required this.id,
    required this.name,
    required this.code,
    required this.year,
    required this.description,
    required this.icon,
    this.pdfCount = 0,
    this.sortOrder = 0,
  });

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'name': name,
      'code': code,
      'year': year,
      'description': description,
      'icon': icon,
      'pdfCount': pdfCount,
      'sortOrder': sortOrder,
    };
  }

  factory SubjectModel.fromMap(Map<String, dynamic> map, String docId) {
    return SubjectModel(
      id: docId,
      name: map['name'] ?? '',
      code: map['code'] ?? '',
      year: map['year'] ?? '1st Year',
      description: map['description'] ?? '',
      icon: map['icon'] ?? 'menu_book',
      pdfCount: map['pdfCount'] ?? 0,
      sortOrder: map['sortOrder'] ?? 0,
    );
  }
}
