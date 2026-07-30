import 'package:flutter_test/flutter_test.dart';

import 'package:cubes_app/main.dart';

void main() {
  testWidgets('shows Supabase setup guidance when env is missing', (WidgetTester tester) async {
    await tester.pumpWidget(
      const CubesApp(
        bootstrap: SupabaseBootstrap._(isConfigured: false),
      ),
    );

    expect(find.text('Connect Supabase to continue'), findsOneWidget);
    expect(find.textContaining('flutter run --project-dir app'), findsOneWidget);
  });
}
