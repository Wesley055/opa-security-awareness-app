import 'package:flutter/material.dart';
import 'features/sos/sos_page.dart';

class OpaApp extends StatelessWidget {
  const OpaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'OPA',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF008753)),
        useMaterial3: true,
      ),
      home: const SosPage(),
    );
  }
}